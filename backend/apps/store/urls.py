from django.urls import path
from .views import StoreProfilePublicView, AdminStoreProfileView

urlpatterns = [
    path("profile/", StoreProfilePublicView.as_view(), name="store-profile-public"),
    path("admin/profile/", AdminStoreProfileView.as_view(), name="store-profile-admin"),
]
