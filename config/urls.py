from django.contrib import admin
from django.urls import include, path
import os
from dotenv import load_dotenv

load_dotenv()

admin_url = os.getenv("admin")

urlpatterns = [
    path(admin_url, admin.site.urls),
    path("api/", include("wordapp.urls")),
    path("", include("wordapp.urls")),
]