"""Log into Inventory Manager and download the all-time Inventory + Sales reports."""
import os
import re
import sys
import pathlib
from playwright.sync_api import sync_playwright

BASE = os.environ.get("IM_BASE_URL", "https://inventory-manager-peach-alpha.vercel.app/")
EMAIL = os.environ["IM_EMAIL"]
PASSWORD = os.environ["IM_PASSWORD"]
OUT = pathlib.Path(os.environ.get("OUT_DIR", "out"))
OUT.mkdir(parents=True, exist_ok=True)


def save(download, name):
    path = OUT / name
    download.save_as(path)
    size = path.stat().st_size
    print(f"  saved {name} ({size:,} bytes)", flush=True)
    if size < 5_000:
        raise SystemExit(f"{name} is suspiciously small ({size} bytes) - aborting")
    return path


def open_inventory_range_menu(page):
    """Open the Inventory Report date-range menu.

    Careful: the top bar also has an *Import* Inventory Report button, and a loose
    'Inventory Report' match hits that one first, which opens the import dialog
    instead of the range menu. Match the nav button exactly.
    """
    exact = page.get_by_role("button", name=re.compile(r"^\s*INVENTORY REPORT\s*$", re.I))
    if exact.count():
        exact.first.click()
        return "nav button"
    aria = page.get_by_role("button", name=re.compile(r"pick a date range", re.I))
    if aria.count():
        aria.first.click()
        return "aria-label"
    raise SystemExit("could not find the Inventory Report date-range button")


def click_all_time(page, label):
    """Click the exact 'All Time' entry. Not 'View All Time in browser', and not
    the 'ALL TIME 717' stat tile - exact match keeps both out."""
    btn = page.get_by_role("button", name="All Time", exact=True).first
    btn.wait_for(state="visible", timeout=25_000)
    with page.expect_download(timeout=120_000) as dl:
        btn.click()
    print(f"  {label}: download started", flush=True)
    return dl.value


def run(date_str):
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(accept_downloads=True, viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        try:
            print("login...", flush=True)
            page.goto(BASE, wait_until="networkidle", timeout=60_000)
            page.fill('input[type="email"]', EMAIL)
            page.fill('input[type="password"]', PASSWORD)
            page.get_by_role("button", name=re.compile(r"^\s*Sign In\s*$", re.I)).click()
            page.wait_for_selector('button:has-text("Add Stock")', timeout=60_000)
            print("  signed in", flush=True)

            print("inventory report (all time)...", flush=True)
            how = open_inventory_range_menu(page)
            print(f"  range menu opened via {how}", flush=True)
            page.wait_for_timeout(1200)
            inv = save(click_all_time(page, "inventory"),
                       f"Inventory-Report-All-Time-{date_str}.xlsx")

            print("sales report (all time)...", flush=True)
            page.get_by_role("button", name=re.compile(r"Open menu", re.I)).first.click()
            page.wait_for_timeout(1200)
            page.get_by_role("button", name=re.compile(r"^\s*INVENTORY\s*$", re.I)).first.click()
            page.wait_for_timeout(3000)
            page.get_by_role("button", name=re.compile(r"^SALES REPORT", re.I)).first.click()
            page.wait_for_timeout(1500)
            sales = save(click_all_time(page, "sales"),
                         f"Sales-Report-All-Time-{date_str}.xlsx")
            return inv, sales
        except Exception:
            page.screenshot(path=str(OUT / "failure.png"), full_page=True)
            print("--- buttons visible at failure ---", flush=True)
            try:
                names = page.eval_on_selector_all(
                    "button", "els => els.map(e => (e.innerText||'').trim().replace(/\\s+/g,' ').slice(0,60)).filter(Boolean)")
                for n in names[:40]:
                    print(f"    {n}", flush=True)
            except Exception:
                pass
            raise
        finally:
            ctx.close()
            browser.close()


if __name__ == "__main__":
    inv, sales = run(sys.argv[1])
    print(f"INVENTORY_FILE={inv}\nSALES_FILE={sales}")
