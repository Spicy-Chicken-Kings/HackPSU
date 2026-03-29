"""
BrainPause — Python Flask Backend (Gemini API - FIXED)
"""

import json
import os
import re
from flask import Flask, request, jsonify
from flask_cors import CORS
from google import genai

client = genai.Client()

app = Flask(__name__)
CORS(app, origins=["https://www.instagram.com", "chrome-extension://*"])


# ---------------------------------------------------------------------------
# 🔒 Safe Gemini call helper (IMPROVED JSON EXTRACTION)
# ---------------------------------------------------------------------------
def generate_json(prompt):
    raw = ""
    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",  # Using a more stable model
            contents=prompt,
            config={
                "temperature": 0.3,  # Lower temperature for more consistent JSON
                "max_output_tokens": 500,
            }
        )

        raw = response.text.strip()
        app.logger.info(f"Raw response: {raw[:200]}")  # Log first 200 chars

        # Try multiple methods to extract JSON
        
        # Method 1: Find JSON between curly braces
        json_match = re.search(r'\{[^{}]*\}', raw, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group())
            except:
                pass
        
        # Method 2: More aggressive - find from first { to last }
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start != -1 and end != -1 and end > start:
            json_str = raw[start:end]
            try:
                return json.loads(json_str)
            except json.JSONDecodeError as e:
                app.logger.error(f"JSON decode error: {e}\nString: {json_str}")
        
        # Method 3: Try to find JSON with newlines and nested braces
        brace_count = 0
        start_index = -1
        for i, char in enumerate(raw):
            if char == '{':
                if brace_count == 0:
                    start_index = i
                brace_count += 1
            elif char == '}':
                brace_count -= 1
                if brace_count == 0 and start_index != -1:
                    json_str = raw[start_index:i+1]
                    try:
                        return json.loads(json_str)
                    except:
                        continue
        
        # If all methods fail, log and return None
        app.logger.error(f"Could not extract valid JSON from: {raw[:500]}")
        return None

    except Exception as e:
        app.logger.error(f"Gemini API error: {str(e)}\nRaw: {raw[:500] if raw else 'N/A'}")
        return None


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

    prompt = f"""You are the BrainPause Brain Pet, a warm and encouraging mindfulness companion.
Evaluate the user's response and return ONLY valid JSON, no other text.

Prompt type: {prompt_type}
User wrote: {user_response}

Rules:
- Be specific to what they wrote
- Do NOT give a high score for negative or meaningless responses. level_up should be assigned based 'False' in these cases.
- Keep message 1-2 sentences

Return EXACTLY this JSON format (no markdown, no explanations):
{{"score": 5, "message": "Your specific response here", "level_up": false}}

Score must be 1-10. Level_up should be true only if score >= 8.
"""

    result = generate_json(prompt)

    if not result or not isinstance(result, dict):
        return jsonify({
            "score": 5,
            "message": "Nice reflection — keep going 💜",
            "level_up": False
        })

    # Ensure all required fields exist with proper types
    return jsonify({
        "score": int(result.get("score", 5)),
        "message": str(result.get("message", "Nice reflection! 💜")),
        "level_up": bool(result.get("level_up", False))
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

    prompt = f"""You are a mindfulness feed analyst. Analyze this feed content for harmful patterns.
Return ONLY valid JSON, no other text.

Feed content:
{content_str}

Identify harmful patterns like:
- comparison culture
- anxiety
- body image issues
- FOMO
- political stress

Return EXACTLY this JSON format:
{{"concerning_count": 0, "categories": [], "recommendation": "Your recommendation here"}}

concerning_count: number of concerning items found (0-{len(sample)})
categories: array of strings (use empty array if none)
recommendation: one sentence advice
"""

    result = generate_json(prompt)

    if not result or not isinstance(result, dict):
        return jsonify({
            "concerning_count": 0,
            "categories": [],
            "recommendation": "Your feed looks alright — stay mindful!"
        })

    return jsonify({
        "concerning_count": int(result.get("concerning_count", 0)),
        "categories": list(result.get("categories", [])),
        "recommendation": str(result.get("recommendation", "Stay mindful!"))
    })


# ---------------------------------------------------------------------------
# POST /test-gemini (DEBUG endpoint)
# ---------------------------------------------------------------------------
@app.route("/test-gemini", methods=["POST"])
def test_gemini():
    """Test endpoint to debug Gemini responses"""
    test_prompt = "Return exactly this JSON: {\"test\": \"success\", \"number\": 123}"
    result = generate_json(test_prompt)
    return jsonify({
        "success": result is not None,
        "result": result,
        "raw_test": "Check logs for raw response"
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