// Page actions shared by tests of index.html and judge.html (same Pick component).
const { DOM } = require("./browser");

async function prepare(page) {
  await page.eval(DOM);
}

// Type the exact element name into the slot's search box and pick it from the dropdown.
async function addElement(page, slot, name) {
  await page.eval(`(() => {
    const input = [...document.querySelectorAll('input[placeholder="Поиск элемента..."]')][${slot}];
    input.focus();
    __t.setValue(input, ${JSON.stringify(name)});
    return true;
  })()`);
  await page.waitFor(`(() => {
    const input = [...document.querySelectorAll('input[placeholder="Поиск элемента..."]')][${slot}];
    const list = input.parentElement.nextElementSibling;
    const item = list && [...list.children].find(d => d.firstElementChild && d.firstElementChild.textContent === ${JSON.stringify(name)});
    if (!item) return false;
    item.click();
    return true;
  })()`);
  await page.waitFor(`[...document.querySelectorAll("span")].some(s => s.textContent === ${JSON.stringify(name)} && !s.closest('[style*="position: absolute"]'))`);
}

async function selectAthlete(page, id) {
  await page.eval(`(() => {
    const sel = [...document.querySelectorAll("select")].find(s => [...s.options].some(o => o.value === ${JSON.stringify(id)}));
    __t.setValue(sel, ${JSON.stringify(id)});
    return true;
  })()`);
}

async function results(page) {
  return page.eval(`JSON.parse(localStorage.getItem("comp_freestyle_results") || "[]")`);
}

module.exports = { prepare, addElement, selectAthlete, results };
