"""PubMed/NCBI E-utilities integration.

Wraps the NCBI ``esearch``/``efetch`` endpoints behind a rate-limited client and
normalizes raw records into our own paper shape (see ``Paper``) which is cached
in PostgreSQL. Raw API payloads are never persisted — only normalized fields.
"""

from __future__ import annotations

import json
import re
import threading
import time
import xml.etree.ElementTree as ET
from datetime import date
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.paper import Paper
from app.schemas.literature import LiteraturePaper, SearchResponse

_EFETCH_CHUNK_SIZE = 150


class PubMedError(Exception):
    """Base class for all PubMed integration failures."""


class PubMedApiError(PubMedError):
    """PubMed could not be reached or returned a non-OK status."""


class PubMedRateLimitError(PubMedError):
    """PubMed throttled us (HTTP 429)."""


class PubMedResponseError(PubMedError):
    """PubMed returned a payload we could not parse."""


class PubMedNotFoundError(PubMedError):
    """The requested PMID does not exist in PubMed."""


class RateLimiter:
    """Serializes outbound requests and enforces a minimum interval between them."""

    def __init__(self, min_interval: float) -> None:
        self._min_interval = max(0.0, min_interval)
        self._last = 0.0
        self._lock = threading.Lock()

    def wait(self) -> None:
        """Block until the configured interval has elapsed since the last call."""
        if self._min_interval == 0:
            return
        with self._lock:
            now = time.monotonic()
            delay = self._min_interval - (now - self._last)
            if delay > 0:
                time.sleep(delay)
                now = time.monotonic()
            self._last = now


_MONTHS = {
    "Jan": 1,
    "Feb": 2,
    "Mar": 3,
    "Apr": 4,
    "May": 5,
    "Jun": 6,
    "Jul": 7,
    "Aug": 8,
    "Sep": 9,
    "Oct": 10,
    "Nov": 11,
    "Dec": 12,
}
_YEAR_RE = re.compile(r"(19|20)\d{2}")


def _eutils_params(tool: str, email: str | None, api_key: str | None) -> dict[str, str]:
    params: dict[str, str] = {"tool": tool}
    if email:
        params["email"] = email
    if api_key:
        params["api_key"] = api_key
    return params


class PubMedClient:
    """Thin, rate-limited wrapper around NCBI's ``esearch``/``efetch``."""

    def __init__(
        self,
        *,
        base_url: str | None = None,
        email: str | None = None,
        api_key: str | None = None,
        min_interval: float | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._base_url = base_url or get_settings().ncbi_base_url
        self._email = email if email is not None else get_settings().pubmed_email
        self._api_key = api_key if api_key is not None else get_settings().pubmed_api_key
        if min_interval is None:
            min_interval = 0.1 if self._api_key else 0.34
        self._rate = RateLimiter(min_interval)
        self._http = httpx.Client(base_url=self._base_url, transport=transport, timeout=30.0)

    def close(self) -> None:
        self._http.close()

    def _request(self, path: str, params: dict[str, Any]) -> str:
        self._rate.wait()
        try:
            resp = self._http.get(path, params=params)
        except httpx.RequestError as exc:
            raise PubMedApiError(f"could not reach PubMed: {exc}") from exc

        if resp.status_code == 429:
            raise PubMedRateLimitError("PubMed rate limit reached; try again shortly")
        if resp.status_code == 400 and "api key" in resp.text.lower():
            raise PubMedApiError("PubMed rejected the request (check PUBMED_API_KEY)")
        if resp.status_code != 200:
            raise PubMedApiError(f"PubMed returned HTTP {resp.status_code}")
        return resp.text

    def esearch(self, query: str, *, retstart: int = 0, retmax: int = 20) -> tuple[list[int], int]:
        """Return ``(pmid_list, total_matches)`` for a term-based search."""
        params: dict[str, Any] = {
            "db": "pubmed",
            "term": query,
            "retmode": "json",
            "retstart": retstart,
            "retmax": retmax,
        }
        params.update(_eutils_params("evidenceos", self._email, self._api_key))
        text = self._request("esearch.fcgi", params)
        return self._parse_esearch(text)

    def efetch(self, pmids: list[int]) -> list[dict[str, Any]]:
        """Return normalized paper dicts for the given PMIDs (batched)."""
        unique: list[int] = []
        seen: set[int] = set()
        for pmid in pmids:
            if pmid not in seen:
                seen.add(pmid)
                unique.append(pmid)

        articles: list[dict[str, Any]] = []
        for start in range(0, len(unique), _EFETCH_CHUNK_SIZE):
            chunk = unique[start : start + _EFETCH_CHUNK_SIZE]
            params: dict[str, Any] = {
                "db": "pubmed",
                "id": ",".join(str(p) for p in chunk),
                "retmode": "xml",
            }
            params.update(_eutils_params("evidenceos", self._email, self._api_key))
            articles.extend(self._parse_efetch(self._request("efetch.fcgi", params)))
        return articles

    @staticmethod
    def _parse_esearch(text: str) -> tuple[list[int], int]:
        try:
            payload = json.loads(text)
        except json.JSONDecodeError as exc:
            raise PubMedResponseError("PubMed search returned malformed JSON") from exc

        result = payload.get("esearchresult")
        if not isinstance(result, dict):
            raise PubMedResponseError("PubMed search response is missing esearchresult")

        raw_ids = result.get("idlist") or []
        pmids: list[int] = []
        for raw in raw_ids:
            try:
                pmids.append(int(raw))
            except TypeError, ValueError:
                continue
        try:
            total = int(result.get("count") or 0)
        except TypeError, ValueError:
            total = len(pmids)
        return pmids, total

    @staticmethod
    def _parse_efetch(text: str) -> list[dict[str, Any]]:
        try:
            root = ET.fromstring(text)
        except ET.ParseError as exc:
            raise PubMedResponseError("PubMed fetch returned malformed XML") from exc

        articles: list[dict[str, Any]] = []
        for element in root.findall("PubmedArticle"):
            articles.append(_normalize_article(element))
        return articles


def get_pubmed_client() -> PubMedClient:
    """Return a module-level singleton so tests can swap in a mocked client."""
    client = getattr(get_pubmed_client, "_instance", None)
    if client is None:
        client = PubMedClient()
        get_pubmed_client._instance = client
    return client


def _text_of(element: ET.Element | None) -> str:
    if element is None:
        return ""
    return "".join(element.itertext()).strip()


def _normalize_article(article: ET.Element) -> dict[str, Any]:
    """Convert a ``PubmedArticle`` XML element into normalized paper fields."""
    citation = article.find("MedlineCitation")
    if citation is None:
        raise PubMedResponseError("PubMed returned an article without MedlineCitation")

    pmid: int | None = None
    try:
        pmid = int(_text_of(citation.find("PMID")))
    except TypeError, ValueError:
        pass
    if not pmid:
        raise PubMedResponseError("PubMed returned an article without a valid PMID")

    abstract: str | None = None
    abstract_block = citation.find("Article/Abstract")
    if abstract_block is not None:
        parts: list[str] = []
        for block in abstract_block.findall("AbstractText"):
            label = (block.get("Label") or "").strip()
            body = _text_of(block)
            if label and body:
                parts.append(f"{label}: {body}")
            elif label or body:
                parts.append(label or body)
        if parts:
            abstract = " ".join(parts)

    authors = _extract_authors(citation)

    journal: str | None = None
    journal_element = citation.find("Article/Journal/Title")
    if journal_element is None:
        journal_element = citation.find("Article/Journal/ISOAbbreviation")
    if journal_element is not None:
        journal = _text_of(journal_element) or None

    publication_date = _extract_publication_date(citation)
    doi = _extract_doi(article)

    title = _text_of(citation.find("Article/ArticleTitle"))

    return {
        "pmid": pmid,
        "title": _clip(title or "Untitled", 500),
        "abstract": abstract,
        "authors": authors,
        "journal": _clip(journal, 300) if journal else None,
        "publication_date": publication_date,
        "doi": _clip(doi, 200) if doi else None,
        "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
    }


def _extract_authors(citation: ET.Element) -> list[str]:
    author_list = citation.find("Article/AuthorList")
    if author_list is None:
        return []
    names: list[str] = []
    for author in author_list.findall("Author"):
        collective = (author.findtext("CollectiveName") or "").strip()
        if collective:
            names.append(collective)
            continue
        last = (author.findtext("LastName") or "").strip()
        if not last:
            continue
        fore = (author.findtext("ForeName") or "").strip()
        initials = (author.findtext("Initials") or "").strip()
        if fore:
            names.append(f"{fore} {last}")
        elif initials:
            names.append(f"{last} {initials}")
        else:
            names.append(last)
    return names


def _extract_publication_date(citation: ET.Element) -> date | None:
    pub_date = citation.find("Article/Journal/JournalIssue/PubDate")
    if pub_date is None:
        return None

    year = _int_or_none(pub_date.findtext("Year"))
    if year is None:
        medline_date = pub_date.findtext("MedlineDate") or ""
        match = _YEAR_RE.search(medline_date)
        year = int(match.group(0)) if match else None
    if year is None:
        return None

    month_raw = pub_date.findtext("Month") or ""
    month = _MONTHS.get(month_raw.strip())
    day = _int_or_none(pub_date.findtext("Day"))

    try:
        if month and day:
            return date(year, month, day)
        if month:
            return date(year, month, 1)
        return date(year, 1, 1)
    except ValueError:
        return None


def _extract_doi(article: ET.Element) -> str | None:
    doi = _text_of(article.find("PubmedData/ArticleIdList/ArticleId[@IdType='doi']"))
    if not doi:
        doi = _text_of(article.find("MedlineCitation/Article/ELocationID[@EIdType='doi']"))
    return doi or None


def _int_or_none(value: str | None) -> int | None:
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _clip(value: str, length: int) -> str:
    return value if len(value) <= length else value[:length]


def _store_new_papers(db: Session, articles: list[dict[str, Any]]) -> list[Paper]:
    """Insert normalized papers that are not already cached; return them."""
    papers: list[Paper] = []
    for article in articles:
        existing = db.scalar(select(Paper).where(Paper.pmid == article["pmid"]))
        if existing is not None:
            papers.append(existing)
            continue
        paper = Paper(**article)
        db.add(paper)
        papers.append(paper)
    return papers


def search_literature(
    query: str,
    page: int = 1,
    page_size: int = 25,
    db: Session | None = None,
) -> SearchResponse:
    """Search PubMed, cache the normalized results, and return a page of papers.

    Repeated searches for the same PMIDs re-use the cached rows rather than
    creating duplicates.
    """
    query = (query or "").strip()
    if not query:
        raise ValueError("Query must not be empty")
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)

    pmid_list, total = get_pubmed_client().esearch(
        query, retstart=(page - 1) * page_size, retmax=page_size
    )
    owns_db = db is None
    session = db or SessionLocal()
    try:
        if not pmid_list:
            return SearchResponse(
                query=query, page=page, page_size=page_size, total=total, items=[]
            )

        cached = {
            paper.pmid: paper
            for paper in session.scalars(select(Paper).where(Paper.pmid.in_(pmid_list)))
        }
        missing = [pmid for pmid in pmid_list if pmid not in cached]
        if missing:
            articles = get_pubmed_client().efetch(missing)
            for article in articles:
                if article["pmid"] in cached:
                    continue
                session.add(Paper(**article))
            session.commit()

        rows = {
            paper.pmid: paper
            for paper in session.scalars(select(Paper).where(Paper.pmid.in_(pmid_list)))
        }
        items = [LiteraturePaper.model_validate(rows[pmid]) for pmid in pmid_list if pmid in rows]
        return SearchResponse(query=query, page=page, page_size=page_size, total=total, items=items)
    finally:
        if owns_db:
            session.close()


def get_paper(pmid: int, db: Session | None = None) -> LiteraturePaper:
    """Return a normalized paper by PMID, using the DB cache when possible."""
    owns_db = db is None
    session = db or SessionLocal()
    try:
        cached = session.scalar(select(Paper).where(Paper.pmid == pmid))
        if cached is not None:
            return LiteraturePaper.model_validate(cached)

        articles = get_pubmed_client().efetch([pmid])
        if not articles:
            raise PubMedNotFoundError(f"No paper found in PubMed for PMID {pmid}")
        stored = _store_new_papers(session, articles)
        session.commit()
        return LiteraturePaper.model_validate(stored[0])
    finally:
        if owns_db:
            session.close()
