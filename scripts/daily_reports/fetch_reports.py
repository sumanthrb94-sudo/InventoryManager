"""Log into Inventory Manager and download the all-time Inventory + Sales reports."""
import os, re, sys, pathlib
from playwright.sync_api import sync_playwright, expect

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
            page.wait_for_selector('button:has-text("Inventory Report")', timeout=60_000)

            print("inventory report (all time)...", flush=True)
            page.get_by_role("button", name=re.compile(r"Inventory Report")).first.click()
            page.wait_for_timeout(800)
            with page.expect_download(timeout=90_000) as dl:
                page.get_by_role("button", name="All Time", exact=True).first.click()
            inv = save(dl.value, f"Inventory-Report-All-Time-{date_str}.xlsx")

            print("sales report (all time)...", flush=True)
            page.get_by_role("button", name=re.compile(r"Open menu", re.I)).first.click()
            page.wait_for_timeout(800)
            page.get_by_role("button", name=re.compile(r"^\s*INVENTORY\s*$", re.I)).first.click()
            page.wait_for_timeout(2500)
            page.get_by_role("button", name=re.compile(r"^SALES REPORT", re.I)).first.click()
            page.wait_for_timeout(1200)
            with page.expect_download(timeout=120_000) as dl:
                page.get_by_role("button", name="All Time", exact=True).first.click()
            sales = save(dl.value, f"Sales-Report-All-Time-{date_str}.xlsx")
            return inv, sales
        except Exception:
            page.screenshot(path=str(OUT / "failure.png"), full_page=True)
            print("--- page text at failure ---", flush=True)
            print(page.inner_text("body")[:2000], flush=True)
            raise
        finally:
            ctx.close(); browser.close()


if __name__ == "__main__":
    inv, sales = run(sys.argv[1])
    print(f"INVENTORY_FILE={inv}\nSALES_FILE={sales}")
