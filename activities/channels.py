"""Raw channel sends: sms today; voice/webhook are future work."""

from pydantic import BaseModel
from temporalio import activity

from app.api.twilio_utils import load_org_twilio_auth_token
from app.services.clients.supabase_client import get_service_role_client
from app.services.clients.twilio_client import send_sms


class SendSmsInput(BaseModel):
    """Arguments to `send_sms_message`."""

    to: str
    body: str
    from_: str | None = None
    messaging_service_sid: str | None = None
    subaccount_sid: str | None = None
    org_id: str | None = None


class SendSmsResult(BaseModel):
    """Result of `send_sms_message`."""

    message_sid: str


@activity.defn
async def send_sms_message(input: SendSmsInput) -> SendSmsResult:
    """Send one SMS via Twilio and return its message SID."""
    auth_token: str | None = None
    if input.subaccount_sid and input.org_id:
        client = await get_service_role_client()
        auth_token = await load_org_twilio_auth_token(client, input.org_id)

    message_sid = await send_sms(
        to=input.to,
        from_=input.from_,
        body=input.body,
        messaging_service_sid=input.messaging_service_sid,
        subaccount_sid=input.subaccount_sid,
        auth_token=auth_token,
    )
    return SendSmsResult(message_sid=message_sid)
