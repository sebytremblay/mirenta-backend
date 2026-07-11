"""Raw channel sends: sms today; voice/webhook are future work."""

from pydantic import BaseModel
from temporalio import activity

from app.services.clients.twilio_client import send_sms


class SendSmsInput(BaseModel):
    """Arguments to `send_sms_message`."""

    to: str
    body: str
    from_: str | None = None
    messaging_service_sid: str | None = None
    subaccount_sid: str | None = None


class SendSmsResult(BaseModel):
    """Result of `send_sms_message`."""

    message_sid: str


@activity.defn
async def send_sms_message(input: SendSmsInput) -> SendSmsResult:
    """Send one SMS via Twilio and return its message SID."""
    message_sid = await send_sms(
        to=input.to,
        from_=input.from_,
        body=input.body,
        messaging_service_sid=input.messaging_service_sid,
        subaccount_sid=input.subaccount_sid,
    )
    return SendSmsResult(message_sid=message_sid)
