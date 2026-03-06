"""
Calendar agent pre J.A.L.Z.A.
Microsoft Graph Calendar API — plné ovládanie kalendára.
"""

import os
import time
import logging
import requests
from datetime import datetime, timedelta, timezone
from typing import Optional, Union

logger = logging.getLogger("jalza.calendar")

_env_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.isfile(_env_path):
    with open(_env_path) as _ef:
        for _line in _ef:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip())


class MicrosoftGraphCalendar:
    TOKEN_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
    GRAPH_URL = "https://graph.microsoft.com/v1.0"

    def __init__(self, mailbox: str):
        self.tenant_id = os.environ.get("MS_TENANT_ID", "")
        self.client_id = os.environ.get("MS_CLIENT_ID", "")
        self.client_secret = os.environ.get("MS_CLIENT_SECRET", "")
        self.mailbox = mailbox
        self._token: Optional[str] = None
        self._token_expires = 0.0

    @property
    def configured(self) -> bool:
        return bool(self.tenant_id and self.client_id and self.client_secret)

    def _ensure_token(self):
        if self._token and time.time() < self._token_expires - 60:
            return
        r = requests.post(
            self.TOKEN_URL.format(tenant=self.tenant_id),
            data={
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "scope": "https://graph.microsoft.com/.default",
                "grant_type": "client_credentials",
            },
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        self._token = data["access_token"]
        self._token_expires = time.time() + data.get("expires_in", 3600)

    def _headers(self) -> dict:
        self._ensure_token()
        return {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
            "Prefer": 'outlook.timezone="Europe/Bratislava"',
        }

    def _user_url(self, path: str = "") -> str:
        return f"{self.GRAPH_URL}/users/{self.mailbox}{path}"

    # ── List events ───────────────────────────────────────────────────

    def list_events(
        self,
        start: Optional[str] = None,
        end: Optional[str] = None,
        limit: int = 20,
    ) -> list[dict]:
        now = datetime.now(timezone.utc)
        if not start:
            start = now.strftime("%Y-%m-%dT00:00:00Z")
        if not end:
            end = (now + timedelta(days=7)).strftime("%Y-%m-%dT23:59:59Z")

        r = requests.get(
            self._user_url("/calendarView"),
            headers=self._headers(),
            params={
                "startDateTime": start,
                "endDateTime": end,
                "$top": limit,
                "$orderby": "start/dateTime",
                "$select": "id,subject,start,end,location,organizer,isAllDay,bodyPreview,attendees,webLink",
            },
            timeout=30,
        )
        r.raise_for_status()
        events = r.json().get("value", [])
        return [self._format_event(e) for e in events]

    def get_event(self, event_id: str) -> dict:
        r = requests.get(
            self._user_url(f"/events/{event_id}"),
            headers=self._headers(),
            params={
                "$select": "id,subject,start,end,location,organizer,isAllDay,body,attendees,webLink,recurrence",
            },
            timeout=15,
        )
        r.raise_for_status()
        return self._format_event(r.json(), full_body=True)

    # ── Create event ──────────────────────────────────────────────────

    def create_event(
        self,
        subject: str,
        start: str,
        end: str,
        location: str = "",
        body: str = "",
        attendees: Optional[list[str]] = None,
        is_all_day: bool = False,
        reminder_minutes: int = 15,
    ) -> dict:
        tz = "Europe/Bratislava"
        event_data: dict = {
            "subject": subject,
            "start": {"dateTime": start, "timeZone": tz},
            "end": {"dateTime": end, "timeZone": tz},
            "isReminderOn": True,
            "reminderMinutesBeforeStart": reminder_minutes,
        }

        if location:
            event_data["location"] = {"displayName": location}

        if body:
            event_data["body"] = {"contentType": "Text", "content": body}

        if attendees:
            event_data["attendees"] = [
                {
                    "emailAddress": {"address": email},
                    "type": "required",
                }
                for email in attendees
            ]

        if is_all_day:
            event_data["isAllDay"] = True
            event_data["start"] = {"dateTime": start.split("T")[0], "timeZone": tz}
            event_data["end"] = {"dateTime": end.split("T")[0], "timeZone": tz}

        r = requests.post(
            self._user_url("/events"),
            headers=self._headers(),
            json=event_data,
            timeout=30,
        )
        r.raise_for_status()
        created = r.json()
        logger.info(f"[Calendar] Event created: {subject}")
        return self._format_event(created)

    # ── Update event ──────────────────────────────────────────────────

    def update_event(self, event_id: str, updates: dict) -> dict:
        tz = "Europe/Bratislava"
        patch_data: dict = {}

        if "subject" in updates:
            patch_data["subject"] = updates["subject"]
        if "start" in updates:
            patch_data["start"] = {"dateTime": updates["start"], "timeZone": tz}
        if "end" in updates:
            patch_data["end"] = {"dateTime": updates["end"], "timeZone": tz}
        if "location" in updates:
            patch_data["location"] = {"displayName": updates["location"]}
        if "body" in updates:
            patch_data["body"] = {"contentType": "Text", "content": updates["body"]}

        r = requests.patch(
            self._user_url(f"/events/{event_id}"),
            headers=self._headers(),
            json=patch_data,
            timeout=15,
        )
        r.raise_for_status()
        logger.info(f"[Calendar] Event updated: {event_id[:20]}")
        return self._format_event(r.json())

    # ── Delete event ──────────────────────────────────────────────────

    def delete_event(self, event_id: str) -> dict:
        r = requests.delete(
            self._user_url(f"/events/{event_id}"),
            headers=self._headers(),
            timeout=15,
        )
        r.raise_for_status()
        logger.info(f"[Calendar] Event deleted: {event_id[:20]}")
        return {"status": "deleted"}

    # ── Search events ─────────────────────────────────────────────────

    def search_events(self, query: str, limit: int = 10) -> list[dict]:
        now = datetime.now(timezone.utc)
        start = (now - timedelta(days=30)).strftime("%Y-%m-%dT00:00:00Z")
        end = (now + timedelta(days=90)).strftime("%Y-%m-%dT23:59:59Z")

        r = requests.get(
            self._user_url("/calendarView"),
            headers=self._headers(),
            params={
                "startDateTime": start,
                "endDateTime": end,
                "$top": limit,
                "$orderby": "start/dateTime",
                "$filter": f"contains(subject,'{query}')",
                "$select": "id,subject,start,end,location,organizer,isAllDay,bodyPreview",
            },
            timeout=30,
        )
        r.raise_for_status()
        events = r.json().get("value", [])
        return [self._format_event(e) for e in events]

    # ── Today's events ────────────────────────────────────────────────

    def today_events(self) -> list[dict]:
        now = datetime.now(timezone.utc)
        start = now.strftime("%Y-%m-%dT00:00:00Z")
        end = now.strftime("%Y-%m-%dT23:59:59Z")
        return self.list_events(start=start, end=end, limit=50)

    # ── This week's events ────────────────────────────────────────────

    def week_events(self) -> list[dict]:
        now = datetime.now(timezone.utc)
        start = now.strftime("%Y-%m-%dT00:00:00Z")
        end = (now + timedelta(days=7)).strftime("%Y-%m-%dT23:59:59Z")
        return self.list_events(start=start, end=end, limit=50)

    # ── Format helper ─────────────────────────────────────────────────

    def _format_event(self, e: dict, full_body: bool = False) -> dict:
        organizer_data = e.get("organizer", {}).get("emailAddress", {})
        location = e.get("location", {})
        location_name = location.get("displayName", "") if isinstance(location, dict) else str(location)

        attendee_list = []
        for a in e.get("attendees", []):
            addr = a.get("emailAddress", {})
            attendee_list.append({
                "name": addr.get("name", ""),
                "email": addr.get("address", ""),
                "status": a.get("status", {}).get("response", "none"),
            })

        result = {
            "id": e.get("id", ""),
            "subject": e.get("subject", "(bez názvu)"),
            "start": e.get("start", {}).get("dateTime", ""),
            "end": e.get("end", {}).get("dateTime", ""),
            "is_all_day": e.get("isAllDay", False),
            "location": location_name,
            "organizer": organizer_data.get("name", ""),
            "organizer_email": organizer_data.get("address", ""),
            "attendees": attendee_list,
            "web_link": e.get("webLink", ""),
        }

        if full_body:
            body = e.get("body", {})
            result["body"] = body.get("content", "") if isinstance(body, dict) else str(body)
        else:
            result["preview"] = e.get("bodyPreview", "")

        return result


# ══════════════════════════════════════════════════════════════════════
#  Global instances
# ══════════════════════════════════════════════════════════════════════

_cal_adsun = MicrosoftGraphCalendar(
    os.environ.get("MS_MAILBOX", "info@adsun.sk")
)
_cal_juraj = MicrosoftGraphCalendar(
    os.environ.get("MS_MAILBOX_JURAJ", "juraj@adsun.sk")
)


def _get_calendar(account: str = "juraj") -> MicrosoftGraphCalendar:
    if account == "adsun":
        return _cal_adsun
    return _cal_juraj


# ══════════════════════════════════════════════════════════════════════
#  Public API functions
# ══════════════════════════════════════════════════════════════════════

def list_calendar_events(
    account: str = "juraj",
    start: Optional[str] = None,
    end: Optional[str] = None,
    limit: int = 20,
) -> Union[list, dict]:
    cal = _get_calendar(account)
    if not cal.configured:
        return {"error": "Microsoft Graph nie je nakonfigurovaný."}
    try:
        return cal.list_events(start=start, end=end, limit=limit)
    except Exception as e:
        return {"error": f"Calendar API: {str(e)[:200]}"}


def get_calendar_event(event_id: str, account: str = "juraj") -> dict:
    cal = _get_calendar(account)
    if not cal.configured:
        return {"error": "Microsoft Graph nie je nakonfigurovaný."}
    try:
        return cal.get_event(event_id)
    except Exception as e:
        return {"error": str(e)[:200]}


def create_calendar_event(
    subject: str,
    start: str,
    end: str,
    account: str = "juraj",
    location: str = "",
    body: str = "",
    attendees: Optional[list[str]] = None,
    is_all_day: bool = False,
) -> dict:
    cal = _get_calendar(account)
    if not cal.configured:
        return {"error": "Microsoft Graph nie je nakonfigurovaný."}
    try:
        return cal.create_event(
            subject=subject,
            start=start,
            end=end,
            location=location,
            body=body,
            attendees=attendees,
            is_all_day=is_all_day,
        )
    except Exception as e:
        return {"error": str(e)[:200]}


def update_calendar_event(event_id: str, updates: dict, account: str = "juraj") -> dict:
    cal = _get_calendar(account)
    if not cal.configured:
        return {"error": "Microsoft Graph nie je nakonfigurovaný."}
    try:
        return cal.update_event(event_id, updates)
    except Exception as e:
        return {"error": str(e)[:200]}


def delete_calendar_event(event_id: str, account: str = "juraj") -> dict:
    cal = _get_calendar(account)
    if not cal.configured:
        return {"error": "Microsoft Graph nie je nakonfigurovaný."}
    try:
        return cal.delete_event(event_id)
    except Exception as e:
        return {"error": str(e)[:200]}


def today_calendar(account: str = "juraj") -> Union[list, dict]:
    cal = _get_calendar(account)
    if not cal.configured:
        return {"error": "Microsoft Graph nie je nakonfigurovaný."}
    try:
        return cal.today_events()
    except Exception as e:
        return {"error": str(e)[:200]}


def week_calendar(account: str = "juraj") -> Union[list, dict]:
    cal = _get_calendar(account)
    if not cal.configured:
        return {"error": "Microsoft Graph nie je nakonfigurovaný."}
    try:
        return cal.week_events()
    except Exception as e:
        return {"error": str(e)[:200]}


def search_calendar(query: str, account: str = "juraj", limit: int = 10) -> Union[list, dict]:
    cal = _get_calendar(account)
    if not cal.configured:
        return {"error": "Microsoft Graph nie je nakonfigurovaný."}
    try:
        return cal.search_events(query, limit)
    except Exception as e:
        return {"error": str(e)[:200]}


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO)

    account = sys.argv[1] if len(sys.argv) > 1 else "juraj"
    action = sys.argv[2] if len(sys.argv) > 2 else "today"

    cal = _get_calendar(account)
    if not cal.configured:
        print("CHYBA: MS Graph nie je nakonfigurovaný")
        sys.exit(1)

    if action == "today":
        events = today_calendar(account)
        if isinstance(events, dict) and "error" in events:
            print(f"Chyba: {events['error']}")
        else:
            print(f"Dnes: {len(events)} udalostí\n")
            for ev in events:
                print(f"  {ev['start'][:16]}  {ev['subject']}  ({ev['location']})")
    elif action == "week":
        events = week_calendar(account)
        if isinstance(events, dict) and "error" in events:
            print(f"Chyba: {events['error']}")
        else:
            print(f"Tento týždeň: {len(events)} udalostí\n")
            for ev in events:
                print(f"  {ev['start'][:16]}  {ev['subject']}  ({ev['location']})")
    else:
        print(f"Neznáma akcia: {action}")
        print("Dostupné: today, week")
