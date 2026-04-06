import { main } from "./creator.js";

main().catch((e) => {
  console.error(e);
  const errBox = document.getElementById("creator-error");
  const errMsg = document.getElementById("creator-error-msg");
  if (errBox && errMsg) {
    errBox.hidden = false;
    errMsg.textContent =
      e?.message || "Something went wrong loading the character creator.";
  }
});
