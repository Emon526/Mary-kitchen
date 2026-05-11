"""Business logic for user operations."""
import hashlib
import hmac
import logging
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from .models import OTPCode, User

logger = logging.getLogger(__name__)


def _get_otp_secret() -> bytes:
    key = getattr(settings, "OTP_SECRET_KEY", "") or settings.SECRET_KEY
    return key.encode("utf-8")


def _hash_otp(plain_code: str) -> str:
    """Return HMAC-SHA256 hex digest of the plain OTP code."""
    return hmac.new(_get_otp_secret(), plain_code.encode("utf-8"), hashlib.sha256).hexdigest()


def send_otp(email: str, purpose: str) -> tuple[OTPCode, bool]:
    """Generate, save and dispatch an OTP for the given email/purpose.

    Returns (otp, email_sent). The OTP is always persisted regardless of
    delivery outcome so the user can always request a resend.
    """
    OTPCode.objects.filter(email=email, purpose=purpose, is_used=False).update(is_used=True)

    plain_code = OTPCode.generate_code(length=settings.OTP_LENGTH)
    hashed_code = _hash_otp(plain_code)
    expiry = timezone.now() + timedelta(minutes=settings.OTP_EXPIRY_MINUTES)

    otp = OTPCode.objects.create(
        email=email,
        code=hashed_code,
        purpose=purpose,
        expires_at=expiry,
    )

    try:
        user = User.objects.get(email=email)
        otp.user = user
        otp.save(update_fields=["user"])
    except User.DoesNotExist:
        pass

    from apps.notifications.tasks import send_otp_email

    try:
        send_otp_email.delay(email=email, code=plain_code, purpose=purpose)
    except Exception:
        logger.exception("send_otp: could not dispatch OTP email for %s purpose=%s", email, purpose)
        return otp, False

    return otp, True


def verify_otp(email: str, code: str, purpose: str) -> tuple[bool, str]:
    """Verify an OTP code. Returns (success, message)."""
    try:
        otp = OTPCode.objects.get(email=email, purpose=purpose, is_used=False)
    except OTPCode.DoesNotExist:
        return False, "No active OTP found for this email."
    except OTPCode.MultipleObjectsReturned:
        otp = OTPCode.objects.filter(email=email, purpose=purpose, is_used=False).latest("created_at")

    if otp.is_expired:
        return False, "OTP has expired. Please request a new one."

    otp.attempts += 1
    otp.save(update_fields=["attempts"])

    if otp.attempts > 5:
        return False, "Too many attempts. Please request a new OTP."

    # Timing-safe comparison against the stored HMAC hash.
    if not hmac.compare_digest(otp.code, _hash_otp(code)):
        return False, "Invalid OTP code."

    otp.is_used = True
    otp.save(update_fields=["is_used"])
    return True, "OTP verified successfully."
