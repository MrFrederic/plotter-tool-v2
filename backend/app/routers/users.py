from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User
from app.schemas import UserCreate, UserRead

router = APIRouter(prefix="/users", tags=["users"])


@router.post("/", response_model=UserRead, status_code=201)
async def create_user(
    payload: UserCreate, db: AsyncSession = Depends(get_db)
) -> User:
    user = User(display_name=payload.display_name)
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


@router.get("/", response_model=list[UserRead])
async def list_users(db: AsyncSession = Depends(get_db)) -> list[User]:
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    return list(result.scalars().all())


@router.get("/{user_id}", response_model=UserRead)
async def get_user(
    user_id: UUID, db: AsyncSession = Depends(get_db)
) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user
