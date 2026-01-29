from playwright.sync_api import sync_playwright

def verify_flash_replica():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the page
        page.goto("http://localhost:8001/flash_cs3_replica/index.html")

        # Wait for the toolbar to be visible
        page.wait_for_selector("#toolbar")

        # Click on the Brush tool
        page.click(".tool-btn[data-tool='brush']")

        # Wait a bit to ensure UI updates
        page.wait_for_timeout(500)

        # Take a screenshot
        page.screenshot(path="verification/flash_replica.png")

        browser.close()

if __name__ == "__main__":
    verify_flash_replica()
