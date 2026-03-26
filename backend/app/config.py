from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = (
        "postgresql+asyncpg://plotter:plotter_dev@db:5432/plotter_tool"
    )
    CACHE_DIR: str = "/cache"
    CORS_ORIGINS: list[str] = ["*"]

    model_config = {"env_prefix": "PLOTTER_"}


settings = Settings()
