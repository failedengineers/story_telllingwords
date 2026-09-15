from django.conf import settings
from django.core.cache import cache
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from django.shortcuts import render

from groq import Groq
import json
import random


def home(request):
    return render(request, "index.html")


# --- recent-word tracking -------------------------------------------------
# Groq has no memory between calls, so "don't repeat yourself" has to be
# enforced on our side: we keep a rolling list of the last N words we've
# served (per-process cache) and tell the model to avoid all of them.
RECENT_WORDS_CACHE_KEY = "word_nook_recent_words"
RECENT_WORDS_MAX = 40          # how many past words we remember/exclude
CACHE_TTL_SECONDS = 60 * 60 * 6  # forget words after 6 hours either way
MAX_GENERATION_ATTEMPTS = 4     # retries if the model repeats a recent word


def _get_recent_words():
    return cache.get(RECENT_WORDS_CACHE_KEY, [])


def _remember_word(word):
    recent = _get_recent_words()
    recent.append(word.lower())
    # keep only the most recent N, oldest falls off first
    recent = recent[-RECENT_WORDS_MAX:]
    cache.set(RECENT_WORDS_CACHE_KEY, recent, CACHE_TTL_SECONDS)


def _build_system_prompt(exclude_words):
    exclude_block = ""
    if exclude_words:
        exclude_block = (
            "\n\nDO NOT choose any of these words — they were already used "
            "recently, so pick something different:\n"
            + ", ".join(exclude_words)
        )

    return f"""
You are a professional English vocabulary curator.

Your job is to generate ONE interesting English word for a vocabulary-learning
website.

IMPORTANT:
Do not repeatedly choose the small set of English words that AI models
commonly generate for vocabulary-learning prompts. Explore the English
language broadly.

WORD SELECTION:
- Choose exactly ONE real English word.
- Choose a legitimate dictionary word.
- Prefer moderately uncommon but useful vocabulary.
- Prefer words that an educated English learner would genuinely benefit from learning.
- The word should be interesting because of its meaning, usage, or nuance.
- Use intermediate to advanced vocabulary.
- Explore the full vocabulary of English rather than repeatedly selecting
  famous vocabulary examples.
- Randomly vary between nouns, verbs, adjectives, and adverbs.
- Vary the semantic category of the word.
- Consider vocabulary related to emotions, personality, human behavior,
  communication, thinking, relationships, society, nature, creativity,
  work, movement, experiences, abstract concepts, and everyday situations.
- Avoid always choosing words describing feelings or abstract concepts.
- Avoid always choosing adjectives.
- Avoid words that are extremely common in everyday English.

DO NOT choose obvious or overused vocabulary such as:

serendipity
ephemeral
ubiquitous
eloquent
meticulous
resilient
enigmatic
whimsical
profound
nostalgia
sonder
petrichor
ethereal
mellifluous
ambiguous
ineffable
perseverance
tenacious
benevolent
altruistic
aesthetic
cathartic
melancholy
euphoria
wanderlust
serene
vibrant
diligent
pragmatic
versatile
intricate
formidable
conundrum
paradox
eloquence
sagacious
quintessential
juxtaposition
magnanimous
audacious
gregarious
loquacious
fastidious
ostentatious
recalcitrant
cacophony
solitude
epiphany
resplendent
transient
ambivalent
cryptic
fervent
impeccable
novel
arbitrary
inevitable
subtle
intriguing

Also avoid simply generating another famous vocabulary-list word that is
not included above.{exclude_block}

Think broadly before choosing.

The word should feel like:
"I probably haven't seen this word many times, but this is actually useful
and worth learning."

DO NOT use:
- names
- people
- places
- brands
- abbreviations
- slang
- offensive words
- internet slang
- highly specialized technical terminology
- invented words

MEANING:
- Give exactly one meaning.
- Make it accurate.
- Keep it short.
- Explain it naturally rather than using complicated dictionary language.
- Do not give synonyms.
- Do not give an example sentence.

OUTPUT:
Return ONLY valid JSON.

Use exactly:

{{
    "word": "example",
    "meaning": "A concise and easy-to-understand definition."
}}

Do not include Markdown.
Do not include explanations.
Do not include anything outside the JSON.
"""


# A handful of different nudge phrasings for the user turn, picked at
# random each request, so we're not sending Groq the exact same prompt
# text every time (identical prompts + high temperature still cluster
# around the same handful of "safe" answers more than you'd expect).
USER_PROMPT_VARIANTS = [
    "Generate one fresh English vocabulary word. Do not choose a famous, "
    "obvious, or commonly generated vocabulary word. Explore a different "
    "area of English vocabulary and choose something distinctive, useful, "
    "and genuinely interesting to learn. Make the choice feel unexpected "
    "rather than predictable. Return only the JSON object.",

    "Pick a single English word that most fluent speakers would not use "
    "in daily conversation but that is genuinely worth learning. Favor "
    "verbs or nouns tied to concrete actions, behaviors, or situations "
    "rather than abstract feelings. Return only the JSON object.",

    "Surprise me with an English word from a part of the vocabulary that "
    "vocabulary apps rarely touch — think everyday activities, social "
    "dynamics, physical movement, or craftsmanship. Return only the JSON "
    "object.",

    "Choose one underused but practical English word, the kind a well-read "
    "person would drop into conversation naturally. Avoid anything "
    "overly poetic or abstract this time. Return only the JSON object.",
]


@csrf_exempt
@require_POST
def generate_word(request):
    try:
        client = Groq(api_key=settings.GROK_API_KEY)

        recent_words = _get_recent_words()
        last_error = None

        for attempt in range(MAX_GENERATION_ATTEMPTS):
            system_prompt = _build_system_prompt(recent_words)
            user_prompt = random.choice(USER_PROMPT_VARIANTS)

            response = client.chat.completions.create(
               model="qwen/qwen3.6-27b",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=1.3,
                top_p=1.0,
                max_completion_tokens=100,
                
            )

            content = response.choices[0].message.content.strip()

            try:
                data = json.loads(content)
            except json.JSONDecodeError as e:
                last_error = f"Invalid JSON from model: {e}"
                continue

            word = data.get("word")
            meaning = data.get("meaning")

            if not word or not meaning:
                last_error = "Invalid response from AI."
                continue

            if word.lower() in recent_words:
                # model repeated a recent word despite instructions -
                # retry rather than serve a duplicate
                last_error = f"Model repeated recent word: {word}"
                continue

            _remember_word(word)
            return JsonResponse({"word": word, "meaning": meaning})

        # exhausted all attempts without a fresh word
        return JsonResponse(
            {"error": "Unable to generate a unique word.", "details": last_error},
            status=500,
        )

    except Exception as e:
        print("GROQ ERROR:", repr(e))

        return JsonResponse(
            {
                "error": "Unable to generate a word.",
                "details": str(e),
            },
            status=500,
        )
