"""Aggregate API router."""

from fastapi import APIRouter

from app.api.routes import health, papers, reviews

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(reviews.router)
api_router.include_router(papers.router)

__all__ = ["api_router"]
