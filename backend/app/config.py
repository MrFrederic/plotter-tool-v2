from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = (
        "postgresql+asyncpg://plotter:plotter_dev@db:5432/plotter_tool"
    )
    CACHE_DIR: str = "/cache"
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    model_config = {"env_prefix": ""}


settings = Settings()
