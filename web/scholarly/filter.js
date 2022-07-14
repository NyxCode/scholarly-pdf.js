window.scholarlyCollections = [
  {name: "Collection 1", id: 1},
  {name: "Collection 2", id: 2},
  {name: "Collection 3", id: 3},
  {name: "Collection 4", id: 4},
  {name: "Collection 5", id: 5},
]

const SELECT = document.getElementById("scholarlyFilter");
const ALL_OPTION = document.getElementById("scholarlyFilterAll");
const HIDDEN_OPTION = document.getElementById("scholarlyDisplayOption");

const options = new Map();
let filter = [];

export function initFilter() {
  createOptions();
  updateFilter();
  SELECT.addEventListener("input", onSelect)
}

// Returns an array of collection IDs (numbers) which are filtered.
// If the returned array is empty, all annotations should be shown.
export function getFilter() {
  return [...this.filter];
}

// run when an option is selected
function onSelect() {
  if (SELECT.value === 'all') {
    filter = [];
  } else {
    let colID = parseInt(SELECT.value);
    if (filter.includes(colID)) {
      filter = filter.filter(id => id !== colID);
    } else {
      filter.push(colID);
    }
  }
  updateFilter();
  SELECT.value = "null";
}

// creates an <option> for every collection in the dropdown
function createOptions() {
  window.scholarlyCollections.forEach(col => {
    let opt = document.createElement("option");
    opt.setAttribute("value", col.id.toString());
    opt.innerHTML = col.name;
    options.set(col.id, opt);
    SELECT.appendChild(opt);
  })
}

function updateFilter() {
  // set color of options to show if they are selected or not
  for(let [colID, option] of options.entries()) {
    option.style.color = filter.includes(colID) ? 'black' : 'gray';
  }

  if(filter.length === 0) {
    ALL_OPTION.style.color = 'black';
    HIDDEN_OPTION.innerHTML = 'All Collections'
  } else {
    ALL_OPTION.style.color = 'gray';
    HIDDEN_OPTION.innerHTML = `${filter.length} Selected`
  }
}
