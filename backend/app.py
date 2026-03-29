"""
BrainPause — Python Flask Backend (Gemini API - UPDATED)
"""

import json
import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from google import genai

# Initialize client (uses GEMINI_API_KEY from environment)
client = genai.Client()

app = Flask(__name__)
CORS(app, origins=["https://www.instagram.com", "chrome-extension://*"])


# ---------------------------------------------------------------------------
# POST /validate-prompt
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

    prompt = f"""
You are the BrainPause Brain Pet, a warm and encouraging mindfulness companion.
Evaluate the user's response and return JSON only. Do not give a good score if the response is negative or not comprehendable. Integrate the user's response into the message. 

Prompt type: {prompt_type}
User wrote: {user_response}

Return JSON:
{{
  "score": <1-10>,
  "message": "<1-2 sentence encouraging response>",
  "level_up": <true/false>
}}
"""

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config={
                "temperature": 0.7,
                "max_output_tokens": 300,
            }
        )

        raw = response.text.strip()

        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        result = json.loads(raw)

        result["score"] = int(result.get("score", 5))
        result["level_up"] = bool(result.get("level_up", False))
        result["message"] = str(result.get("message", "Nice reflection! 💜"))

        return jsonify(result)

    except Exception as e:
        app.logger.error("Gemini API error: %s", e)
        return jsonify({
            "score": 5,
            "message": "Great work! 🌟",
            "level_up": False
        })


# ---------------------------------------------------------------------------
# POST /scan-feed
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

    sample = feed_items[:15]
    content_str = "\n---\n".join(str(s) for s in sample)

    prompt = f"""
You are a mindfulness feed analyst.

Analyze this social media feed for harmful patterns like:
- comparison culture
- anxiety-inducing news
- body image issues
- FOMO
- political stress

Feed:
{content_str}

Return JSON:
{{
  "concerning_count": <int>,
  "categories": ["<type>", ...],
  "recommendation": "<one sentence suggestion>"
}}
"""

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config={
                "temperature": 0.7,
                "max_output_tokens": 300,
            }
        )

        raw = response.text.strip()

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
        })


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "BrainPause API"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, port=port)