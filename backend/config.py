from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    # Authentication
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours

    # Admin credentials
    ADMIN_PASSWORD: str

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # Paths
    DATA_DIR: str = "./data"
    MODELS_DIR: str = "./data/models"
    TRAJECTORIES_DIR: str = "./data/trajectories"

    class Config:
        env_file = ".env"
        case_sensitive = True

    def get_models_path(self) -> Path:
        return Path(self.MODELS_DIR).resolve()

    def get_trajectories_path(self) -> Path:
        return Path(self.TRAJECTORIES_DIR).resolve()


settings = Settings()
