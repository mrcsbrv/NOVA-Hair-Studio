#!/usr/bin/env python3
"""Comprueba enlaces, semántica y reglas CSS del panel, sin red ni dependencias.

No valida RLS, una sesión real, el layout ni la experiencia de lector de pantalla.
"""

from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
import base64
import json
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
    checks = 0
    failures = []

    def check(condition, message):
        nonlocal checks
        checks += 1
        if not condition:
            failures.append(message)

    for name in ("admin.html", "admin.css", "admin.js"):
        check((ROOT / name).is_file(), f"Falta {name}")
    if failures:
        for failure in failures:
            print(f"ERROR: {failure}")
        return True

    html = (ROOT / "admin.html").read_text()
    css = (ROOT / "admin.css").read_text()
    script = (ROOT / "admin.js").read_text()
    doc = Document()
    doc.feed(html)
    ids = [attrs["id"] for _, attrs, _ in doc.elements if "id" in attrs]
    known_ids = set(ids)
    known_ids.update(re.findall(r'\bid=["\']([\w-]+)["\']', script))
    labels = {attrs.get("for") for tag, attrs, _ in doc.elements if tag == "label"}
    check(len(ids) == len(set(ids)), "Hay IDs duplicados en admin.html")
    check(any(tag == "html" and attrs.get("lang") == "es" for tag, attrs, _ in doc.elements), "Falta lang=es")
    check(any(tag == "meta" and attrs.get("name") == "viewport" for tag, attrs, _ in doc.elements), "Falta viewport móvil")
    check(sum(tag == "main" for tag, _, _ in doc.elements) == 1, "Debe existir un único main")
    check(any(tag == "h1" for tag, _, _ in doc.elements), "Falta título principal")
    check(any(attrs.get("aria-live") in ("polite", "assertive") or attrs.get("role") in ("status", "alert") for _, attrs, _ in doc.elements), "Faltan mensajes accesibles de estado")
    check(any(tag == "dialog" for tag, _, _ in doc.elements), "Falta diálogo semántico para confirmar cancelaciones")
    dashboard = next((attrs for _, attrs, _ in doc.elements if attrs.get("id") == "dashboard"), {})
    check("hidden" in dashboard, "El panel privado debe estar oculto antes de verificar la sesión")

    password_inputs = []
    script_sources = []
    local_sources = []
    stylesheets = []
    for tag, attrs, line in doc.elements:
        prefix = f"admin.html:{line}"
        if tag == "a" and attrs.get("href", "").startswith("#"):
            check(attrs["href"][1:] in known_ids, f"{prefix}: enlace interno sin destino")
        if tag == "label" and attrs.get("for"):
            check(attrs["for"] in known_ids, f"{prefix}: label sin control")
        for name in ("aria-controls", "aria-describedby", "aria-labelledby"):
            for target in attrs.get(name, "").split():
                check(target in known_ids, f"{prefix}: referencia {name} inexistente: {target}")
        if tag in ("input", "select", "textarea") and attrs.get("type") not in ("hidden", "submit", "button"):
            check(attrs.get("id") in labels or attrs.get("aria-label") or attrs.get("aria-labelledby"), f"{prefix}: control sin nombre accesible")
        if tag == "input" and attrs.get("type") == "password":
            password_inputs.append(attrs)
            check(not attrs.get("value"), f"{prefix}: contraseña predefinida")
            check(attrs.get("autocomplete") == "current-password", f"{prefix}: falta autocomplete=current-password")
        if tag == "button":
            check(attrs.get("type") in ("button", "submit", "reset"), f"{prefix}: botón sin type explícito")
        if tag == "img":
            check("alt" in attrs, f"{prefix}: imagen sin alt")
        if tag == "dialog":
            check(attrs.get("aria-label") or attrs.get("aria-labelledby"), f"{prefix}: diálogo sin nombre accesible")
        if tag == "form":
            check(not attrs.get("action") or attrs["action"].startswith("#"), f"{prefix}: formulario con envío nativo inesperado")

        resource = None
        if tag == "script" and attrs.get("src"):
            resource = attrs["src"]
            script_sources.append(resource)
            check(attrs.get("type") != "module", f"{prefix}: script module incompatible con apertura directa")
            check("async" not in attrs, f"{prefix}: async puede alterar el orden de carga")
        elif tag == "link" and attrs.get("rel") == "stylesheet":
            resource = attrs.get("href")
            stylesheets.append(resource)
        elif tag in ("img", "source"):
            resource = attrs.get("src")
        elif tag == "a" and attrs.get("href") and not attrs["href"].startswith("#"):
            href = attrs["href"]
            if not urlparse(href).scheme:
                check((ROOT / unquote(urlparse(href).path)).is_file(), f"{prefix}: enlace local inexistente")
        if resource:
            parsed = urlparse(resource)
            is_local = not parsed.scheme and not parsed.netloc
            check(is_local or (tag == "script" and resource == SUPABASE_CDN), f"{prefix}: dependencia externa no prevista")
            if is_local:
                path = ROOT / unquote(parsed.path)
                check(path.is_file(), f"{prefix}: recurso local inexistente: {resource}")
                if tag == "script" and path.is_file():
                    local_sources.append(path)

    check(len(password_inputs) == 1, "Debe existir un único campo de contraseña para acceder")
    check("admin.css" in stylesheets, "admin.css no está enlazado")
    check("script.js" not in script_sources, "El panel no debe iniciar el controlador de la web pública")
    check(not [name for name, count in Counter(script_sources).items() if count > 1], "Hay scripts duplicados")
    for source in ("data.js", "salon-time.js", "booking-core.js", "supabase-config.js", "supabase-repository.js", "admin.js", SUPABASE_CDN):
        check(source in script_sources, f"Falta enlazar {source}")
    dependencies = {
        "booking-core.js": ("data.js", "salon-time.js"),
        "supabase-repository.js": ("booking-core.js", "supabase-config.js", SUPABASE_CDN),
        "admin.js": ("data.js", "salon-time.js", "booking-core.js", "supabase-repository.js"),
    }
    if "admin-repository.js" in script_sources:
        dependencies["admin-repository.js"] = ("supabase-repository.js",)
        dependencies["admin.js"] += ("admin-repository.js",)
    for source, prerequisites in dependencies.items():
        for prerequisite in prerequisites:
            check(source in script_sources and prerequisite in script_sources and script_sources.index(prerequisite) < script_sources.index(source), f"Orden incorrecto: {prerequisite} debe preceder a {source}")

    explicit_ids = re.findall(r"getElementById\(\s*['\"]([\w-]+)['\"]\s*\)", script)
    explicit_ids += re.findall(r"(?:\$|querySelector)\(\s*['\"]#([\w-]+)['\"]\s*\)", script)
    for target in explicit_ids:
        check(target in known_ids, f"admin.js busca un ID inexistente: {target}")

    combined_css = css
    for resource in stylesheets:
        if resource != "admin.css" and resource and not urlparse(resource).scheme and (ROOT / resource).is_file():
            combined_css += (ROOT / resource).read_text()
    check(":focus-visible" in combined_css, "Falta estilo de foco visible")
    check("prefers-reduced-motion" in combined_css, "Falta respeto por movimiento reducido")
    check(bool(re.search(r"@media[^{}]+(?:max-width|min-width)", css)), "Faltan reglas responsive específicas del panel")
    check(bool(re.search(r"\[hidden\]\s*\{[^}]*display\s*:\s*none", combined_css)), "Falta regla que respete hidden")
    check("overflow-wrap" in combined_css or "word-break" in combined_css, "Falta protección para contactos largos en móvil")

    # Detecta credenciales privadas literales, no comentarios que prohíben usarlas.
    # No inspecciona ni imprime los valores de supabase-config.js.
    for path in local_sources:
        if path.name == "supabase-config.js":
            continue
        code = path.read_text()
        check(not re.search(r"['\"]sb_secret_[A-Za-z0-9_-]{15,}['\"]", code), f"{path.name}: posible clave secreta literal")
        for token in re.findall(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", code):
            try:
                payload = token.split(".")[1]
                role = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))).get("role")
            except (ValueError, UnicodeDecodeError, AttributeError):
                role = None
            check(role != "service_role", f"{path.name}: token de rol privado no permitido")
    for failure in failures:
        print(f"ERROR: {failure}")
    print(f"Panel: {checks - len(failures)}/{checks} comprobaciones estáticas correctas.")
    print("No comprueba aspecto visual, Supabase Auth real ni políticas RLS.")
    return bool(failures)


if __name__ == "__main__":
    sys.exit(run())
