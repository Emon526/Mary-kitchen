from django.urls import path
from .views import AddToCartView, CartValidateView, CartView, ClearCartView, RemoveCartItemView, UpdateCartItemView

urlpatterns = [
    path("", CartView.as_view(), name="cart"),
    path("validate/", CartValidateView.as_view(), name="cart-validate"),
    path("add/", AddToCartView.as_view(), name="cart-add"),
    path("items/<uuid:item_id>/", UpdateCartItemView.as_view(), name="cart-item-update"),
    path("items/<uuid:item_id>/remove/", RemoveCartItemView.as_view(), name="cart-item-remove"),
    path("clear/", ClearCartView.as_view(), name="cart-clear"),
]
