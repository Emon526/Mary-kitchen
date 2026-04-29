"""Review views."""
from rest_framework import generics, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import ADMIN_API_PERMISSION_CLASSES, IsOwnerOrAdmin

from .models import Review
from .serializers import AdminReviewSerializer, ReviewSerializer


class ProductReviewListView(generics.ListAPIView):
    """GET /api/v1/reviews/products/<product_id>/ – approved reviews for a product."""
    serializer_class = ReviewSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        return Review.objects.filter(
            product_id=self.kwargs["product_id"], is_approved=True
        ).select_related("user")


class CreateReviewView(generics.CreateAPIView):
    """POST /api/v1/reviews/ – submit a review."""
    serializer_class = ReviewSerializer
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class UpdateDeleteReviewView(generics.RetrieveUpdateDestroyAPIView):
    """PATCH/DELETE /api/v1/reviews/<id>/"""
    serializer_class = ReviewSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrAdmin]

    def get_queryset(self):
        return Review.objects.filter(user=self.request.user)


class MarkReviewHelpfulView(APIView):
    """POST /api/v1/reviews/<id>/helpful/"""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            review = Review.objects.get(id=pk, is_approved=True)
            review.helpful_count += 1
            review.save(update_fields=["helpful_count"])
            return Response({"success": True, "helpful_count": review.helpful_count})
        except Review.DoesNotExist:
            return Response({"success": False, "message": "Review not found."}, status=status.HTTP_404_NOT_FOUND)


# ─── Admin ────────────────────────────────────────────────────────────────────

class AdminReviewListView(generics.ListAPIView):
    """Admin: list all reviews with moderation filters."""
    serializer_class = AdminReviewSerializer
    permission_classes = ADMIN_API_PERMISSION_CLASSES
    filterset_fields = ["is_approved", "is_flagged"]
    search_fields = ["user__email", "product__name"]

    def get_queryset(self):
        return Review.objects.all().select_related("user", "product")


class AdminReviewModerateView(APIView):
    """POST /api/v1/reviews/admin/<id>/moderate/"""
    permission_classes = ADMIN_API_PERMISSION_CLASSES

    def post(self, request, pk):
        try:
            review = Review.objects.get(id=pk)
        except Review.DoesNotExist:
            return Response({"success": False, "message": "Review not found."}, status=status.HTTP_404_NOT_FOUND)

        action = request.data.get("action")
        if action == "approve":
            review.is_approved = True
            review.is_flagged = False
        elif action == "reject":
            review.is_approved = False
            review.is_flagged = True
        elif action == "delete":
            review.delete()
            return Response({"success": True, "message": "Review deleted."})
        else:
            return Response({"success": False, "message": "Invalid action."}, status=status.HTTP_400_BAD_REQUEST)

        review.admin_note = request.data.get("admin_note", review.admin_note)
        review.save()
        return Response({"success": True, "data": AdminReviewSerializer(review).data})
