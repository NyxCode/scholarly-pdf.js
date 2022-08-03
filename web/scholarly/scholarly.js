import {
  getColor,
  getMode,
  initUI,
  onModeChange,
  sendEvent,
  setMode,
} from "./ui.js";
import { getTextColor, removeEyeCancer } from "./color_utils.js";
import { getFilter, onFilterChange, shouldShow } from "./filter.js";
import { getScope } from "./scope.js";

window.scholarlyCollections = [
  { name: "Collection 1", id: 1 },
  { name: "Collection 2", id: 2 },
  { name: "Collection 3", id: 3 },
];
window.scholarlyAnnotations = [
  {
    type: "highlight",
    startPosition: { x: 0.3, y: 0.3 },
    endPosition: { x: 0.7, y: 0.7 },
    page: 1,
    color: "#FFFF00",
    collectionId: 2,
    ownerId: 1,
  },
];
window.scholarlyUsers = new Map();
window.scholarlyUserId = 1;
window.scholarlyCurrentCollection = null;

let highlights = [];
let stickyNotes = [];
let es;
let stickyNoteCounter = 1;
let stickyNoteId = 1;

const initializedPages = new Set();
const pages = new Map();

export function init(app) {
  sendEvent("initialized");
  initUI();
  initAnnotations();

  app.eventBus.on("pagerendered", function (event) {
    if (event.cssTransform) {
      return;
    }

    const page = event.pageNumber;
    const canvas = event.source.canvas;
    pages.set(page, {
      canvasElement: canvas,
      pageElement: canvas.parentElement.parentElement,
      source: event.source,
    });

    drawAnnotations(event);
    createHighlight(page);
    createStickyNote(page);
    initEraser(page);
    initializedPages.add(page);
  });

  handleModeChange();
  onFilterChange(() => rerenderPages(initializedPages));
}

async function rerenderPages(rerenderPages) {
  for (const page of rerenderPages) {
    const s = pages.get(page).source;
    s.reset();
    s.draw();
  }

  const viewerContainer = document.getElementById("viewerContainer");
  viewerContainer.scrollTop += 2;
  setTimeout(() => {
    viewerContainer.scrollTop -= 2;
  }, 10);
}

function initEraser(page) {
  if (initializedPages.has(page)) {
    return;
  }

  const { pageElement } = pages.get(page);
  pageElement.addEventListener("click", e => {
    if (getMode() !== "eraser") {
      return;
    }

    const { canvasElement } = pages.get(page);
    const bb = canvasElement.getBoundingClientRect();
    const relX = (e.x - bb.left) / bb.width;
    const relY = (e.y - bb.top) / bb.height;

    const wasClicked = highlight => {
      if (highlight.page !== page) {
        return false;
      }

      let startX = highlight.relPos.x,
        startY = highlight.relPos.y;
      if (highlight.relSize.width < 0) {
        startX += highlight.relSize.width;
      }
      if (highlight.relSize.height < 0) {
        startY += highlight.relSize.height;
      }
      if (relX < startX || relY < startY) {
        return false;
      }

      const endX = startX + Math.abs(highlight.relSize.width);
      const endY = startY + Math.abs(highlight.relSize.height);
      return !(relX > endX || relY > endY);
    };

    const clicked = highlights.filter(wasClicked)[0];

    if (clicked != null) {
      console.log("erasing a highlight", clicked);
      deleteAnnotation(clicked.id, () => {
        highlights = highlights.filter(h => h.id !== clicked.id);
        rerenderPages([page]);
      });
    }
  });
}

export function handleModeChange() {
  let activeStyle = null;
  const styleElements = {};
  const preventDefault = e => e.preventDefault();
  const makeStyleElement = mode => {
    const css = `* { cursor: url(/${mode}.png) 0 24, crosshair !important }`;
    const element = document.createElement("style");
    element.type = "text/css";
    element.append(document.createTextNode(css));
    return element;
  };
  const clearStyle = () => {
    const style = styleElements?.[activeStyle];
    activeStyle = null;
    if (style != null) {
      style.remove();
    }
  };
  const setStyle = mode => {
    activeStyle = mode;
    document.head.append(styleElements[mode]);
  };

  ["eraser", "highlight", "stickyNote"].forEach(
    s => (styleElements[s] = makeStyleElement(s))
  );

  onModeChange(mode => {
    if (mode === "none") {
      clearStyle();
      window.removeEventListener("selectstart", preventDefault);
    } else {
      clearStyle();
      setStyle(mode);
      window.addEventListener("selectstart", preventDefault);
    }
  });
}

function initAnnotations() {
  // Loads the existing annotations into the highlights / stickyNotes array.
  for (const annotation of window.scholarlyAnnotations) {
    if (annotation.type === "highlight") {
      highlights.push({
        id: annotation.id,
        collectionId: annotation.collectionId,
        page: annotation.page,
        relPos: {
          x: annotation.startPosition.x,
          y: annotation.startPosition.y,
        },
        relSize: {
          width: Math.abs(
            annotation.startPosition.x - annotation.endPosition.x
          ),
          height: Math.abs(
            annotation.startPosition.y - annotation.endPosition.y
          ),
        },
        color: annotation.color,
      });
    } else if (annotation.type === "stickyNote") {
      stickyNotes.push({
        id: annotation.id,
        ownerId: annotation.ownerId,
        collectionId: annotation.collectionId,
        stickyNoteId,
        page: annotation.page,
        relPos: { x: annotation.position.x, y: annotation.position.y },
        color: annotation.color,
        content: annotation.content,
      });
      stickyNoteId++;
    } else {
      console.error(`unknown annotation type "${annotation.type}"`);
    }
  }
}

/**
 * Called every time an annotation is created.
 *
 * @param annotation
 * @param callback
 * @param update wheather this is an update, or a new annotation
 */
function sendAnnotation(update, annotation, callback = null) {
  if (update) {
    sendEvent("updateAnnotation", [annotation, callback]);
  } else {
    sendEvent("newAnnotation", [annotation, callback]);
  }
}

function deleteAnnotation(id, callback) {
  sendEvent("deleteAnnotation", [id, callback]);
}

function createHighlight(page) {
  let preview;
  let relX;
  let relY;

  function mouseDownListener(e) {
    if (getMode() !== "highlight") {
      return;
    }

    es = e;
    startDrag(e);

    const { canvasElement, pageElement } = pages.get(page);
    const bb = canvasElement.getBoundingClientRect();
    relX = (e.x - bb.left) / bb.width;
    relY = (e.y - bb.top) / bb.height;
    preview = document.createElement("div");
    preview.style.position = "absolute";
    preview.style.left = e.x - bb.left + "px";
    preview.style.top = e.y - bb.top + "px";
    preview.style.backgroundColor = getColor();
    preview.style.opacity = "0.2";

    pageElement?.querySelector(".annotationEditorLayer")?.appendChild(preview);
  }

  function mouseMoveListener(e) {
    if (getMode() !== "highlight" || preview == null) {
      return;
    }

    const { canvasElement } = pages.get(page);
    const bb = canvasElement.getBoundingClientRect();
    const endRelX = (e.x - bb.left) / bb.width;
    const endRelY = (e.y - bb.top) / bb.height;
    const relWidth = endRelX - relX;
    const relHeight = endRelY - relY;
    const absWidth = relWidth * bb.width;
    const absHeight = relHeight * bb.height;
    preview.style.width = Math.abs(absWidth) + "px";
    preview.style.height = Math.abs(absHeight) + "px";

    if (absWidth < 0) {
      preview.style.left = e.x - bb.left + "px";
    } else {
      preview.style.left = relX * bb.width + "px";
    }

    if (absHeight < 0) {
      preview.style.top = e.y - bb.top + "px";
    } else {
      preview.style.top = relY * bb.height + "px";
    }
  }

  function mouseUpListener(e) {
    if (getMode() !== "highlight" || preview == null) {
      return;
    }

    onDragEnd();
    const { canvasElement, pageElement } = pages.get(page);
    const bb = canvasElement.getBoundingClientRect();
    const relX = (es.x - bb.left) / bb.width;
    const relY = (es.y - bb.top) / bb.height;
    const relW = (e.x - es.x) / bb.width;
    const relH = (e.y - es.y) / bb.height;
    const color = getColor();
    renderRect(canvasElement, relX, relY, relW, relH, color);

    const highlight = {
      collectionId: getScope(),
      page,
      relPos: { x: relX, y: relY },
      relSize: { width: relW, height: relH },
      color,
    };
    highlights.push(highlight);

    sendAnnotation(
      false,
      {
        collectionId: getScope(),
        color,
        page,
        startPosition: { x: relX, y: relY },
        endPosition: { x: relX + relW, y: relY + relH },
        type: "highlight",
      },
      id => (highlight.id = id)
    );

    preview = null;

    if (pageElement != null) {
      pageElement.querySelector(".annotationEditorLayer").innerHTML = "";
    }
  }

  if (!initializedPages.has(page)) {
    const pageElement = pages.get(page).pageElement;
    pageElement.addEventListener("mousedown", mouseDownListener);
    document.addEventListener("mousemove", mouseMoveListener);
    document.addEventListener("mouseup", mouseUpListener);
  }
}

function createStickyNote(page) {
  function mouseClickListener(e) {
    if (getMode() !== "stickyNote") {
      return;
    }

    if (e.y < page.y || e.y > page.y + page.height) {
      return;
    }

    const { canvasElement } = pages.get(page);
    const bb = canvasElement.getBoundingClientRect();
    const relX = (e.x - bb.left) / bb.width;
    const relY = (e.y - bb.top) / bb.height;
    const color = getColor();
    const content = null;

    const thisStickyNoteId = ++stickyNoteId;

    stickyNotes.push({
      ownerId: window.scholarlyUserId,
      collectionId: getScope(),
      stickyNoteId: thisStickyNoteId,
      page,
      relPos: { x: relX, y: relY },
      color,
      content,
    });

    renderNote(
      thisStickyNoteId,
      page,
      relX,
      relY,
      color,
      content,
      getProfilePictureURL(window.scholarlyUserId)
    );

    setMode("none");
  }

  if (!initializedPages.has(page)) {
    const { pageElement } = pages.get(page);
    pageElement.addEventListener("click", mouseClickListener);
  }
}

function drawAnnotations(event) {
  if (getFilter() == null) {
    return;
  }

  for (const element of highlights) {
    if (!shouldShow(element.collectionId)) {
      continue;
    }

    if (element.page === event.pageNumber) {
      renderHighlight(
        event.pageNumber,
        element.relPos,
        element.relSize,
        element.color
      );
    }
  }

  for (const element of stickyNotes) {
    if (!shouldShow(element.collectionId)) {
      continue;
    }

    if (element.page === event.pageNumber) {
      renderStickyNote(
        element.stickyNoteId,
        event.pageNumber,
        element.relPos,
        element.content,
        element.color,
        getProfilePictureURL(element.ownerId)
      );
    }
  }
}

function renderRect(canvas, relX, relY, relW, relH, color) {
  const ctx = canvas.getContext("2d");

  const absX = canvas.width * relX;
  const absY = canvas.height * relY;
  const absW = canvas.width * relW;
  const absH = canvas.height * relH;

  ctx.fillStyle = color;
  ctx.globalAlpha = 0.2;
  ctx.fillRect(absX, absY, absW, absH);
}

function renderNote(
  stickyNoteId,
  page,
  relX,
  relY,
  color,
  content,
  profilePictureURL
) {
  const { canvasElement, pageElement } = pages.get(page);
  color = removeEyeCancer(color);
  const textColor = getTextColor(color);
  const idSave = `StickyNoteSave${stickyNoteCounter}`;
  const idDelete = `StickyNoteDelete${stickyNoteCounter}`;
  const idEdit = `StickyNoteEdit${stickyNoteCounter}`;
  const idSpanEdit = `noteEdit${stickyNoteCounter}`;
  const idSpanDisplay = `noteDisplay${stickyNoteCounter}`;
  stickyNoteCounter++;

  const spanEdit = document.createElement("div");
  spanEdit.innerHTML = `
    <div class="stickynote-wrapper" id="${idSpanEdit}">
      <div class="stickynote-content" style="background-color: ${color}">
        <textarea placeholder="Add a sticky note" style="color: ${textColor}"></textarea>
        <button id="${idSave}">Save</button>
      </div>
      <img alt="Avatar" src="${profilePictureURL}" referrerpolicy="no-referrer" />
    </div>
  `;
  const bb = canvasElement.getBoundingClientRect();
  spanEdit.style.position = "absolute";
  spanEdit.style.top = relY * bb.height + "px";
  spanEdit.style.left = relX * bb.width + "px";
  pageElement.append(spanEdit);

  const spanDisplay = document.createElement("div");
  spanDisplay.setAttribute("id", idSpanDisplay);
  spanDisplay.setAttribute("class", "stickynote-wrapper");
  spanDisplay.innerHTML = `
    <div class="stickynote-content" style="background-color: ${color}; color: ${textColor}">
      <div style="top: 6px" id="${idDelete}">
        <svg style="width:20px; height:20px" viewBox="0 0 24 24">
          <path fill="currentColor" d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z" />
        </svg>
      </div>
      <div style="top: 30px" id="${idEdit}">
        <svg style="width:20px; height:20px" viewBox="0 0 24 24">
          <path fill="currentColor" d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z" />
        </svg>
      </div>
      <p>${content ?? ""}</p>
    </div>
    <img alt="Avatar" src="${profilePictureURL}" referrerpolicy="no-referrer" />
  `;
  spanDisplay.style.position = "absolute";
  spanDisplay.style.top = relY * bb.height + "px";
  spanDisplay.style.left = relX * bb.width + "px";
  pageElement.append(spanDisplay);

  if (content == null) {
    spanDisplay.hidden = true;
  } else {
    spanEdit.hidden = true;
    document.querySelector(
      `.stickynote-wrapper#${idSpanEdit} > div > textarea`
    ).value = content;
    document.querySelector(
      `.stickynote-wrapper#${idSpanDisplay} > div > p`
    ).innerText = content;
  }

  document.getElementById(idDelete).addEventListener("click", () => {
    console.error(stickyNotes);
    console.error("to remove:", stickyNoteId);
    const stickyNote = stickyNotes.find(s => stickyNoteId === s.stickyNoteId);
    deleteAnnotation(stickyNote.id, () => {
      spanDisplay.remove();
      spanEdit.remove();
      stickyNotes = stickyNotes.filter(s => s.stickyNoteId !== stickyNoteId);
    });
  });

  document.getElementById(idEdit).addEventListener("click", () => {
    spanDisplay.hidden = true;
    spanEdit.hidden = false;
  });

  document.getElementById(idSave).addEventListener("click", () => {
    const textField = document.querySelector(
      `.stickynote-wrapper#${idSpanEdit} > div > textarea`
    );
    const paragraph = document.querySelector(
      `.stickynote-wrapper#${idSpanDisplay} > div > p`
    );
    console.log(textField.value);
    spanEdit.hidden = true;
    spanDisplay.hidden = false;

    const stickyNote = stickyNotes.find(s => s.stickyNoteId === stickyNoteId);

    const updated = stickyNote.id != null;
    sendAnnotation(
      updated,
      {
        id: stickyNote.id,
        collectionId: stickyNote.collectionId,
        content: textField.value,
        color: stickyNote.color,
        page: stickyNote.page,
        position: { x: stickyNote.relPos.x, y: stickyNote.relPos.y },
        type: "stickyNote",
      },
      id => {
        paragraph.innerText = textField.value;
        stickyNote.content = textField.value;
        stickyNote.id = id;
      }
    );
  });
}

function startDrag() {
  window.addEventListener("mouseup", onDragEnd);
}

function onDragEnd() {
  window.removeEventListener("mouseup", onDragEnd);
}

function renderStickyNote(
  stickyNoteId,
  page,
  relPos,
  content,
  color,
  profilePictureURL
) {
  renderNote(
    stickyNoteId,
    page,
    relPos.x,
    relPos.y,
    color,
    content,
    profilePictureURL
  );
}

function renderHighlight(page, relPos, relSize, color) {
  const { canvasElement } = pages.get(page);
  renderRect(
    canvasElement,
    relPos.x,
    relPos.y,
    relSize.width,
    relSize.height,
    color
  );
}

function getProfilePictureURL(userId) {
  return (
    window.scholarlyUsers?.get(userId)?.profilePicture ??
    "images/default-user.png"
  );
}
