#!/usr/bin/env python3
"""Comprobaciones de estructura sin dependencias; no sustituyen una revisión visual.

Ejecutar desde cualquier directorio: python3 tests/check_structure.py
"""

from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent.parent
SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"


class Document(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.elements = []

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs), self.getpos()[0]))


def run():
    failures = []
    checks = 0

    def check(condition, message):
        nonlocal checks
        checks += 1
        if not condition:
            failures.append(message)

    html = (ROOT / "index.html").read_text()
    css = (ROOT / "styles.css").read_text()
    script = (ROOT / "script.js").read_text()
    doc = Document()
    doc.feed(html)
    elements = doc.elements
    ids = [attrs["id"] for _, attrs, _ in elements if "id" in attrs]
    known_ids = set(ids)
    # Algunos contenedores y mensajes se crean al renderizar las plantillas JS.
    known_ids.update(re.findall(r'\bid=["\']([\w-]+)["\']', script))
    check(not [key for key, count in Counter(ids).items() if count > 1], "Hay identificadores HTML duplicados")
    check(any(tag == "html" and attrs.get("lang") == "es" for tag, attrs, _ in elements), "Falta lang=es")
    check(any(tag == "meta" and attrs.get("name") == "viewport" for tag, attrs, _ in elements), "Falta viewport móvil")
    check(sum(tag == "main" for tag, _, _ in elements) == 1, "Debe existir un único main")
    check(sum(tag == "h1" for tag, _, _ in elements) == 1, "Debe existir un único h1")

    label_targets = {attrs.get("for") for tag, attrs, _ in elements if tag == "label"}
    script_sources = []
    for tag, attrs, line in elements:
        prefix = f"index.html:{line}"
        if tag == "a" and attrs.get("href", "").startswith("#"):
            fragment = attrs["href"][1:]
            check(bool(fragment) and fragment in known_ids, f"{prefix}: enlace interno sin destino: {attrs['href']}")
        if tag == "label" and attrs.get("for"):
            check(attrs["for"] in known_ids, f"{prefix}: label apunta a un control inexistente")
        for name in ("aria-controls", "aria-describedby", "aria-labelledby"):
            for target in attrs.get(name, "").split():
                check(target in known_ids, f"{prefix}: {name} referencia a {target}, que no existe")
        if tag in ("input", "select", "textarea") and attrs.get("type") not in ("hidden", "submit", "button"):
            named = attrs.get("id") in label_targets or attrs.get("aria-label") or attrs.get("aria-labelledby")
            check(bool(named), f"{prefix}: control sin nombre accesible")
        if tag == "img":
            check("alt" in attrs, f"{prefix}: imagen sin atributo alt")
        if tag == "button":
            check(attrs.get("type") in ("button", "submit", "reset"), f"{prefix}: botón sin type explícito")
        resource = None
        if tag == "script" and attrs.get("src"):
            script_sources.append(attrs["src"])
            resource = attrs["src"]
            check(attrs.get("type") != "module", f"{prefix}: script module dificulta abrir mediante file://")
        elif tag == "link" and attrs.get("rel") == "stylesheet":
            resource = attrs.get("href")
        elif tag == "img":
            resource = attrs.get("src")
        if resource:
            parsed = urlparse(resource)
            allowed_cdn = tag == "script" and resource == SUPABASE_CDN
            check(allowed_cdn or (not parsed.scheme and not parsed.netloc), f"{prefix}: dependencia externa no permitida {resource}")
            if not parsed.scheme and not parsed.netloc:
                check((ROOT / unquote(parsed.path)).is_file(), f"{prefix}: no existe {resource}")

    check("script.js" in script_sources, "script.js no está enlazado")
    for source in ("data.js", "salon-time.js", "booking-core.js", "supabase-config.js", "supabase-repository.js", SUPABASE_CDN):
        check(script_sources.count(source) == 1, f"{source} debe estar enlazado exactamente una vez")
    dependencies = {
        "booking-core.js": ("data.js", "salon-time.js"),
        "supabase-repository.js": ("booking-core.js", "supabase-config.js", SUPABASE_CDN),
        "script.js": ("supabase-repository.js",),
    }
    for source, prerequisites in dependencies.items():
        for prerequisite in prerequisites:
            check(source in script_sources and prerequisite in script_sources and script_sources.index(prerequisite) < script_sources.index(source), f"Orden incorrecto: {prerequisite} debe cargarse antes de {source}")
    for tag, attrs, line in elements:
        if tag == "script" and attrs.get("src") in script_sources:
            check("async" not in attrs, f"index.html:{line}: async no garantiza el orden de los scripts")
    check(any(tag == "link" and attrs.get("href") == "styles.css" for tag, attrs, _ in elements), "styles.css no está enlazado")
    # Errores tipográficos frecuentes que causarían null al arrancar.
    explicit_ids = re.findall(r"getElementById\(\s*['\"]([\w-]+)['\"]\s*\)", script)
    explicit_ids.extend(re.findall(r"\$\(\s*['\"]([\w-]+)['\"]\s*\)", script))
    for target in explicit_ids:
        check(target in known_ids, f"script.js busca un ID inexistente: {target}")
    check("prefers-reduced-motion" in css, "CSS no contempla movimiento reducido")
    check("safe-area-inset-bottom" in css, "CSS no contempla safe area inferior")
    check("scroll-margin" in css or "scroll-padding" in css, "CSS no compensa la cabecera en enlaces internos")
    check(":focus-visible" in css, "CSS no define foco visible")
    check(bool(re.search(r"@media[^{}]+(?:max-width|min-width)", css)), "CSS no contiene reglas responsive")

    for failure in failures:
        print(f"ERROR: {failure}")
    print(f"Estructura: {checks - len(failures)}/{checks} comprobaciones correctas.")
    print("La comprobación estática no verifica el aspecto real ni la navegación con lector de pantalla.")
    return bool(failures)


if __name__ == "__main__":
    sys.exit(run())
