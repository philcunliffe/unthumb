const DEFAULTS = { fraction: 30, random: false, fallback: "original" };

const fractionSlider = document.getElementById("fraction");
const fractionValue = document.getElementById("fraction-value");
const randomCheckbox = document.getElementById("random");
const sliderContainer = document.getElementById("slider-container");
const fallbackRadios = document.querySelectorAll('input[name="fallback"]');

function loadSettings() {
  chrome.storage.sync.get("settings", (result) => {
    const s = { ...DEFAULTS, ...result.settings };
    fractionSlider.value = s.fraction;
    fractionValue.textContent = s.fraction + "%";
    randomCheckbox.checked = s.random;
    sliderContainer.classList.toggle("disabled", s.random);
    for (const r of fallbackRadios) {
      r.checked = r.value === s.fallback;
    }
  });
}

function saveSettings() {
  const settings = {
    fraction: parseInt(fractionSlider.value, 10),
    random: randomCheckbox.checked,
    fallback: document.querySelector('input[name="fallback"]:checked').value
  };
  chrome.storage.sync.set({ settings });
}

fractionSlider.addEventListener("input", () => {
  fractionValue.textContent = fractionSlider.value + "%";
  saveSettings();
});

randomCheckbox.addEventListener("change", () => {
  sliderContainer.classList.toggle("disabled", randomCheckbox.checked);
  saveSettings();
});

for (const r of fallbackRadios) {
  r.addEventListener("change", saveSettings);
}

loadSettings();
