"""Product app URL patterns."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_nested import routers as nested_routers

from .views import (
    AdminAttributeDefinitionViewSet,
    AdminCategoryViewSet,
    AdminLowStockProductsView,
    AdminProductViewSet,
    AdminVariantViewSet,
    CategoryDetailView,
    CategoryListView,
    DealsProductsView,
    FeaturedProductsView,
    ProductDetailView,
    ProductListView,
)

router = DefaultRouter()
router.register("admin/products", AdminProductViewSet, basename="admin-product")
router.register("admin/categories", AdminCategoryViewSet, basename="admin-category")

# Nested routes: /admin/products/<product_pk>/variants/
product_router = nested_routers.NestedDefaultRouter(router, "admin/products", lookup="product")
product_router.register("variants", AdminVariantViewSet, basename="product-variant")

# Nested: /admin/categories/<category_pk>/attributes/
category_router = nested_routers.NestedDefaultRouter(router, "admin/categories", lookup="category")
category_router.register("attributes", AdminAttributeDefinitionViewSet, basename="category-attribute")

urlpatterns = [
    # Public
    path("", ProductListView.as_view(), name="product-list"),
    path("featured/", FeaturedProductsView.as_view(), name="featured-products"),
    path("deals/", DealsProductsView.as_view(), name="product-deals"),
    path("categories/", CategoryListView.as_view(), name="category-list"),
    path("categories/<slug:slug>/", CategoryDetailView.as_view(), name="category-detail"),
    path("<slug:slug>/", ProductDetailView.as_view(), name="product-detail"),
    # Admin
    path("admin/low-stock/", AdminLowStockProductsView.as_view(), name="admin-low-stock-products"),
    path("", include(router.urls)),
    path("", include(product_router.urls)),
    path("", include(category_router.urls)),
]
