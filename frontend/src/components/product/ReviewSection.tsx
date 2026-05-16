"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { formatDate } from "@/lib/utils";
import { Star, ThumbsUp, Pencil, X, Check } from "lucide-react";

export default function ReviewSection({ productId }: { productId: string }) {
  const { isAuthenticated, user } = useAuthStore();
  const qc = useQueryClient();
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const { data: reviews, isLoading } = useQuery({
    queryKey: ["reviews", productId],
    queryFn: () => api.get(`/reviews/products/${productId}/`).then((r) => r.data),
  });

  const reviewList = reviews?.results || reviews || [];
  const myReview = isAuthenticated ? reviewList.find((r: any) => r.user === user?.id) : null;

  const startEdit = () => {
    setRating(myReview.rating);
    setTitle(myReview.title || "");
    setBody(myReview.body || "");
    setEditing(true);
    setShowForm(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setShowForm(false);
    setRating(0); setTitle(""); setBody("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0) { toast.error("Please select a rating"); return; }
    setSubmitting(true);
    try {
      if (editing && myReview) {
        await api.patch(`/reviews/${myReview.id}/`, { rating, title, body });
        toast.success("Review updated!");
        setEditing(false);
      } else {
        await api.post("/reviews/", { product: productId, rating, title, body });
        toast.success("Review submitted!");
      }
      qc.invalidateQueries({ queryKey: ["reviews", productId] });
      setRating(0); setTitle(""); setBody(""); setShowForm(false);
    } catch (e: any) {
      toast.error(e?.response?.data?.errors?.[0]?.message || "Failed to submit review");
    } finally {
      setSubmitting(false);
    }
  };

  const handleHelpful = async (reviewId: string) => {
    try {
      await api.post(`/reviews/${reviewId}/helpful/`);
      qc.invalidateQueries({ queryKey: ["reviews", productId] });
    } catch {}
  };

  return (
    <div className="mt-12 border-t border-gray-200 pt-8">
      <h2 className="section-title mb-6">Customer Reviews</h2>

      {isAuthenticated && (
        myReview && !editing ? (
          /* Your review card */
          <div className="card p-6 mb-8 border-l-4 border-primary-500">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">Your Review</h3>
              <button onClick={startEdit} className="flex items-center gap-1.5 text-xs text-primary-600 hover:text-primary-700 transition-colors">
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            </div>
            <div className="flex gap-0.5 mb-2">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star key={s} className={`w-5 h-5 ${s <= myReview.rating ? "text-amber-400 fill-amber-400" : "text-gray-200"}`} />
              ))}
            </div>
            {myReview.title && <p className="font-medium text-gray-800 mb-1">{myReview.title}</p>}
            {myReview.body && <p className="text-sm text-gray-600 leading-relaxed">{myReview.body}</p>}
            <p className="text-xs text-gray-400 mt-2">{formatDate(myReview.created_at)}</p>
          </div>
        ) : (
          /* Write / edit form — rendered only when the user explicitly opens it */
          <div className="mb-8">
            {!showForm && !editing ? (
              <button
                onClick={() => setShowForm(true)}
                className="btn-primary flex items-center gap-1.5 text-sm"
              >
                <Pencil className="w-4 h-4" /> Write a Review
              </button>
            ) : (
              <div className="card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-gray-900">{editing ? "Edit Your Review" : "Write a Review"}</h3>
                  <button
                    onClick={() => { cancelEdit(); setShowForm(false); }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <p className="text-sm text-gray-600 mb-2">Rating</p>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <button key={s} type="button" onMouseEnter={() => setHoverRating(s)} onMouseLeave={() => setHoverRating(0)} onClick={() => setRating(s)}>
                          <Star className={`w-7 h-7 transition-colors ${s <= (hoverRating || rating) ? "text-amber-400 fill-amber-400" : "text-gray-300"}`} />
                        </button>
                      ))}
                    </div>
                  </div>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Review title (optional)" className="input-field" />
                  <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Share your experience..." className="input-field min-h-[100px] resize-none" />
                  <div className="flex gap-2">
                    <button type="submit" disabled={submitting} className="btn-primary flex items-center gap-1.5">
                      <Check className="w-4 h-4" />
                      {submitting ? "Saving..." : editing ? "Save Changes" : "Submit Review"}
                    </button>
                    <button type="button" onClick={() => { cancelEdit(); setShowForm(false); }} className="btn-secondary">
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        )
      )}

      {/* Reviews list */}
      {isLoading ? (
        <p className="text-gray-400 text-sm">Loading reviews...</p>
      ) : reviewList.length === 0 ? (
        <p className="text-gray-400 text-sm">No reviews yet. Be the first!</p>
      ) : (
        <div className="space-y-4">
          {reviewList.map((review: any) => (
            <div key={review.id} className={`card p-5 ${review.user === user?.id ? "hidden" : ""}`}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{review.user_name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="flex">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star key={s} className={`w-4 h-4 ${s <= review.rating ? "text-amber-400 fill-amber-400" : "text-gray-200"}`} />
                      ))}
                    </div>
                  </div>
                </div>
                <span className="text-xs text-gray-400">{formatDate(review.created_at)}</span>
              </div>
              {review.title && <p className="font-medium text-gray-800 mb-1">{review.title}</p>}
              {review.body && <p className="text-sm text-gray-600 leading-relaxed">{review.body}</p>}
              <button onClick={() => handleHelpful(review.id)} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-primary-600 mt-3 transition-colors">
                <ThumbsUp className="w-3.5 h-3.5" /> Helpful ({review.helpful_count})
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
