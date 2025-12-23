(function () {
  const root = document.getElementById("mini-phone-root");
  const pages = root.querySelectorAll(".page");
  const ren = root.querySelector(".phone-ren");

  function showPage(name) {
    pages.forEach(p => p.classList.remove("active"));

    const page = root.querySelector(".page-" + name);
    if (page) page.classList.add("active");

    // 主界面才显示小人
    if (name === "home") {
      ren.style.display = "block";
    } else {
      ren.style.display = "none";
    }
  }

  root.querySelectorAll("img[data-page]").forEach(icon => {
    icon.addEventListener("click", () => {
      const page = icon.dataset.page;
      showPage(page);
    });
  });

  // 默认进入主界面
  showPage("home");
})();
