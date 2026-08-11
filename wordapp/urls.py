from django.urls import path
from .views import home, generate_word


urlpatterns = [
    path("", home, name="home"),
    path("generate-word/", generate_word, name="generate_word"),
]