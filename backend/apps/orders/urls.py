from django.urls import path
from .views import (
    AdminDashboardStatsView,
    AdminOrderDetailView,
    AdminOrderListView,
    AdminOrderStatusUpdateView,
    AdminRefundStatsView,
    AdminRevenueView,
    AdminTopProductsView,
    CancelOrderView,
    CheckoutView,
    OrderDetailView,
    OrderListView,
)

urlpatterns = [
    path("checkout/", CheckoutView.as_view(), name="checkout"),
    path("", OrderListView.as_view(), name="order-list"),
    path("<str:order_number>/", OrderDetailView.as_view(), name="order-detail"),
    path("<str:order_number>/cancel/", CancelOrderView.as_view(), name="order-cancel"),
    # Admin
    path("admin/stats/", AdminDashboardStatsView.as_view(), name="admin-dashboard-stats"),
    path("admin/revenue/", AdminRevenueView.as_view(), name="admin-revenue"),
    path("admin/top-products/", AdminTopProductsView.as_view(), name="admin-top-products"),
    path("admin/refund-stats/", AdminRefundStatsView.as_view(), name="admin-refund-stats"),
    path("admin/orders/", AdminOrderListView.as_view(), name="admin-order-list"),
    path("admin/orders/<str:order_number>/", AdminOrderDetailView.as_view(), name="admin-order-detail"),
    path("admin/orders/<str:order_number>/status/", AdminOrderStatusUpdateView.as_view(), name="admin-order-status"),
]
