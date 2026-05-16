"""Root URL configuration for Mary Kitchen."""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)

API_V1 = "api/v1/"

urlpatterns = [
    path("admin/", admin.site.urls),

    # API v1
    path(API_V1 + "auth/", include("apps.users.urls.auth_urls")),
    path(API_V1 + "users/", include("apps.users.urls.user_urls")),
    path(API_V1 + "products/", include("apps.products.urls")),
    path(API_V1 + "cart/", include("apps.cart.urls")),
    path(API_V1 + "orders/", include("apps.orders.urls")),
    path(API_V1 + "payments/", include("apps.payments.urls")),
    path(API_V1 + "reviews/", include("apps.reviews.urls")),
    path(API_V1 + "notifications/", include("apps.notifications.urls")),
    path(API_V1 + "delivery/", include("apps.delivery.urls")),
    path(API_V1 + "analytics/", include("apps.analytics.urls")),
    path(API_V1 + "banners/", include("apps.banners.urls")),
    path(API_V1 + "store/", include("apps.store.urls")),

    # API Docs
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
]

if settings.DEBUG:
    import debug_toolbar
    urlpatterns += [path("__debug__/", include(debug_toolbar.urls))]
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
