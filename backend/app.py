"""
BrainPause — Python Flask Backend
Handles:
  - /validate-prompt  : AI evaluation of user's mindful response
  - /scan-feed        : Analyze scraped feed text for mindfulness concerns
"""

import json
import os
from flask import Flask, request, jsonify
from flask_cors import CORS
import anthropic

app = Flask(__name__)
CORS(app, origins=["https://www.instagram.com", "chrome-extension://*"])

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

# ---------------------------------------------------------------------------
# POST /validate-prompt
# Body: { "response": str, "prompt_type": str }
# Returns: { "score": int, "message": str, "level_up": bool }
# ---------------------------------------------------------------------------
@app.route("/validate-prompt", methods=["POST"])
def validate_prompt():
    data = request.get_json(force=True, silent=True) or {}
    user_response = (data.get("response") or "").strip()
    prompt_type = (data.get("prompt_type") or "general").strip()

    if not user_response:
        return jsonify({
            "score": 3,
            "message": "Give it a try — even a few words count! 💜",
            "level_up": False
        })

    system = (
        "You are the BrainPause Brain Pet, a warm and encouraging mindfulness companion. "
        "Your job is to evaluate a user's response to a mindful prompt and give a short, "
        "genuine, uplifting message (1-2 sentences max). Be specific to what they wrote — "
        "no generic filler. Score thoughtfulness 1–10. Only set level_up=true if the "
        "response shows real self-reflection (score >= 7). "
        "RESPOND ONLY WITH VALID JSON, no markdown, no preamble."
    )

    user_msg = (
        f"Prompt type: {prompt_type}\n"
        f"User wrote: {user_response}\n\n"
        'Return JSON: {"score": <1-10>, "message": "<encouraging 1-2 sentence response>", "level_up": <true/false>}'
    )

    try:
        msg = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=200,
            system=system,
            messages=[{"role": "user", "content": user_msg}]
        )
        raw = msg.content[0].text.strip()
        # Strip possible markdown fences
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = json.loads(raw)
        # Sanitize
        result["score"] = int(result.get("score", 5))
        result["level_up"] = bool(result.get("level_up", False))
        result["message"] = str(result.get("message", "Nice reflection! 💜"))
        return jsonify(result)

    except json.JSONDecodeError:
        return jsonify({"score": 5, "message": "Love the reflection! 💜", "level_up": False})
    except anthropic.APIError as e:
        app.logger.error("Anthropic API error: %s", e)
        return jsonify({"score": 5, "message": "Great work! 🌟", "level_up": False}), 200


# ---------------------------------------------------------------------------
# POST /scan-feed
# Body: { "content": ["post text 1", "caption 2", ...] }
# Returns: { "concerning_count": int, "categories": [...], "recommendation": str }
# ---------------------------------------------------------------------------
@app.route("/scan-feed", methods=["POST"])
def scan_feed():
    data = request.get_json(force=True, silent=True) or {}
    feed_items = data.get("content", [])

    if not feed_items:
        return jsonify({
            "concerning_count": 0,
            "categories": [],
            "recommendation": "Nothing to scan yet."
        })

    # Limit to first 15 items to keep prompt small
    sample = feed_items[:15]
    content_str = "\n---\n".join(str(s) for s in sample)

    system = (
        "You are a mindfulness feed analyst. Analyze the provided social media feed captions "
        "for content that could negatively impact mental wellbeing: comparison culture, "
        "anxiety-inducing news, body image issues, FOMO, political stress, etc. "
        "Be concise and practical. "
        "RESPOND ONLY WITH VALID JSON, no markdown."
    )

    user_msg = (
        f"Feed content:\n{content_str}\n\n"
        'Return JSON: {"concerning_count": <int>, "categories": ["<concern type>", ...], '
        '"recommendation": "<one sentence suggestion for a more mindful feed>"}'
    )

    try:
        msg = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=250,
            system=system,
            messages=[{"role": "user", "content": user_msg}]
        )
        raw = msg.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = json.loads(raw)
        return jsonify(result)

    except Exception as e:
        app.logger.error("scan-feed error: %s", e)
        return jsonify({
            "concerning_count": 0,
            "categories": [],
            "recommendation": "Your feed looks alright — stay mindful!"
        }), 200


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "BrainPause API"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, port=port)
