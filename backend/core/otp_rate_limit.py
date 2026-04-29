"""OTP send rate limits (django-ratelimit + Django cache / Redis)."""
from django_ratelimit.core import is_ratelimited

# Max OTP generation requests per window for each dimension (email and IP).
OTP_REQUEST_RATE = "5/10m"


def consume_otp_request_slot(request, email: str):
    """
    Enforce per-email and per-IP limits before sending an OTP.

    Returns (allowed, error_message). On success, both counters are incremented
    for this attempt. If the email bucket is full, the IP counter is not touched.
    """
    email_normalized = (email or "").strip().lower()

    def email_key(group, req):
        return email_normalized

    if is_ratelimited(
        request,
        group="otp_request_email",
        key=email_key,
        rate=OTP_REQUEST_RATE,
        method="POST",
        increment=True,
    ):
        return False, "Too many OTP requests for this email. Try again in a few minutes."

    if is_ratelimited(
        request,
        group="otp_request_ip",
        key="ip",
        rate=OTP_REQUEST_RATE,
        method="POST",
        increment=True,
    ):
        return False, "Too many OTP requests from this network. Try again in a few minutes."

    return True, None
