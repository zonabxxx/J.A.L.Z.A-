"""
Voice agent pre J.A.L.Z.A.
Používa ElevenLabs API na text-to-speech s naklonovaným hlasom.
"""

import os
import json
import requests
import tempfile
import logging

logger = logging.getLogger("jalza.voice")

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.json")
VOICE_CACHE_DIR = os.path.join(os.path.dirname(__file__), "voice_cache")
os.makedirs(VOICE_CACHE_DIR, exist_ok=True)


def load_voice_config() -> dict:
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        return cfg.get("elevenlabs", {})
    except Exception:
        return {}


def list_voices(api_key: str) -> list[dict]:
    r = requests.get(
        "https://api.elevenlabs.io/v1/voices",
        headers={"xi-api-key": api_key},
        timeout=10,
    )
    r.raise_for_status()
    return [{"voice_id": v["voice_id"], "name": v["name"]} for v in r.json().get("voices", [])]


def clone_voice(api_key: str, name: str, audio_files: list[str], description: str = "") -> dict:
    """
    Naklonuje hlas z audio súborov.
    audio_files: zoznam ciest k .mp3/.wav súborom (min. 1 minúta audio)
    """
    files = []
    for path in audio_files:
        files.append(("files", (os.path.basename(path), open(path, "rb"), "audio/mpeg")))

    data = {
        "name": name,
        "description": description or f"J.A.L.Z.A. voice clone: {name}",
    }

    r = requests.post(
        "https://api.elevenlabs.io/v1/voices/add",
        headers={"xi-api-key": api_key},
        data=data,
        files=files,
        timeout=60,
    )

    for _, (_, f, _) in files:
        f.close()

    r.raise_for_status()
    return r.json()


def text_to_speech(text: str, output_path: str = None,
                   api_key: str = None, voice_id: str = None,
                   model_id: str = "eleven_multilingual_v2") -> str:
    """Prevod textu na reč cez ElevenLabs API."""
    cfg = load_voice_config()
    api_key = api_key or cfg.get("api_key", "")
    voice_id = voice_id or cfg.get("voice_id", "")

    if not api_key or not voice_id:
        raise ValueError("ElevenLabs API kľúč alebo voice_id nie je nastavený. Použi /settings v Telegrame.")

    if not output_path:
        output_path = os.path.join(VOICE_CACHE_DIR, f"tts_{hash(text) & 0xFFFFFFFF}.mp3")

    r = requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        headers={
            "xi-api-key": api_key,
            "Content-Type": "application/json",
        },
        json={
            "text": text,
            "model_id": model_id,
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.75,
                "style": 0.0,
                "use_speaker_boost": True,
            },
        },
        timeout=60,
    )
    r.raise_for_status()

    with open(output_path, "wb") as f:
        f.write(r.content)

    return output_path


if __name__ == "__main__":
    import sys
    cfg = load_voice_config()

    if not cfg.get("api_key"):
        print("ElevenLabs nie je nakonfigurovaný.")
        print("Pridaj do config.json:")
        print('  "elevenlabs": {"api_key": "tvoj-kluc", "voice_id": "id-hlasu"}')
        sys.exit(1)

    if len(sys.argv) > 1 and sys.argv[1] == "voices":
        voices = list_voices(cfg["api_key"])
        for v in voices:
            print(f"  {v['voice_id']} — {v['name']}")

    elif len(sys.argv) > 1 and sys.argv[1] == "clone":
        if len(sys.argv) < 4:
            print("Použitie: python3 voice_agent.py clone <meno> <subor1.mp3> [subor2.mp3] ...")
            sys.exit(1)
        name = sys.argv[2]
        files = sys.argv[3:]
        result = clone_voice(cfg["api_key"], name, files)
        print(f"Hlas naklonovaný! Voice ID: {result.get('voice_id')}")

    elif len(sys.argv) > 1 and sys.argv[1] == "say":
        text = " ".join(sys.argv[2:])
        if not text:
            print("Použitie: python3 voice_agent.py say <text>")
            sys.exit(1)
        path = text_to_speech(text)
        print(f"Audio uložené: {path}")
        os.system(f"afplay '{path}'")

    else:
        print("Príkazy:")
        print("  python3 voice_agent.py voices      — zobraz dostupné hlasy")
        print("  python3 voice_agent.py clone <meno> <subor.mp3>  — naklonuj hlas")
        print("  python3 voice_agent.py say <text>   — povedz text")
