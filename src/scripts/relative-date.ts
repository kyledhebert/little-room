import { getRelativeDate } from "../lib/dates";

const updateRelativeDates = () => {
  const relativeDates =
    document.querySelectorAll<HTMLElement>(".relative-date[data-pub-date]");

  relativeDates.forEach((relativeDate) => {
    const pubDate = relativeDate.dataset.pubDate;

    if (pubDate) {
      relativeDate.textContent = getRelativeDate(new Date(pubDate));
    }
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", updateRelativeDates);
} else {
  updateRelativeDates();
}
