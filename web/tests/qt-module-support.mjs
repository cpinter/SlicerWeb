// What the latest SimVascular, SlicerHeart and Sandbox modules ask of the Qt layer, checked in the page
// without them: layouts insert at a place and tell an item's place, a list's currentRow is a property,
// a node selector lists and activates as on the desktop, a signal wired to 'start()' of a timer passes
// no arguments, a line edit reports its cursor, urllib reads files of a site, the Colors module makes a
// color legend, and the Probe Volume With Model CLI module samples a volume at the points of a model.
// Usage: node tests/qt-module-support.mjs [url]
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:5173/";
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(base + "?sample=");
await page.waitForFunction(() => window.slicerWeb?.bridge && document.querySelector("canvas"), null, { timeout: 300000 });

const results = JSON.parse(String(await page.evaluate(() => window.slicerWeb.bridge.evalPython(`
import ctk, json, numpy as np, qt, slicer, urllib.request, vtk
_checks = []
def _check(name, ok, detail=""):
    _checks.append([name, bool(ok), str(detail)])

# layouts
_holder = qt.QWidget()
_layout = qt.QVBoxLayout(_holder)
_first, _second, _between = qt.QLabel("first"), qt.QLabel("second"), qt.QLabel("between")
_layout.addWidget(_first)
_layout.addWidget(_second)
_layout.insertWidget(_layout.indexOf(_first) + 1, _between)
_order = [str(_layout._el.children.item(i).text) for i in range(_layout._el.children.length)]
_check("insertWidget at a place", _order == ["first", "between", "second"], _order)
_check("indexOf a widget", _layout.indexOf(_second) == 2 and _layout.indexOf(qt.QLabel()) == -1)

# properties
_list = qt.QListWidget()
_list.addItem("a"); _list.addItem("b")
_list.currentRow = 1
_check("a list's currentRow is a property", 0 <= _list.currentRow < 2 and _list.currentRow() == 1)
_changed = []
_list.connect("itemChanged(QListWidgetItem*)", lambda item: _changed.append(item.text()))
_checkable = _list.item(0)
_checkable.setFlags(_checkable.flags() | qt.Qt.ItemIsUserCheckable)
_checkable.setCheckState(qt.Qt.Checked)
_check("a list item's check state", _checkable.checkState() == qt.Qt.Checked and _changed == ["a"], _changed)
_label = qt.QLabel("Rp"); _box = qt.QLineEdit(); _label.setBuddy(_box)
_check("a label's buddy", _label.buddy() is _box)
_table = qt.QTableWidget(); _table.setHorizontalHeaderLabels(["A", "B"])
_check("a column's header item", _table.horizontalHeaderItem(1).text() == "B" and _table.horizontalHeaderItem(5) is None)
_check("a header's section size", _table.verticalHeader().defaultSectionSize > 0)
_check("a standard icon", not qt.QApplication.style().standardIcon(qt.QStyle.SP_MessageBoxWarning).isNull())
_item = qt.QTableWidgetItem("x")
_check("an item without an icon", _item.icon().isNull())

# the cursor of a line edit
_moves = []
_box.connect("cursorPositionChanged(int,int)", lambda old, new: _moves.append((old, new)))
_box.text = "1620"
_box.setCursorPosition(0)
_check("a line edit reports its cursor", _moves == [(0, 4), (4, 0)], _moves)

# a node selector
slicer.mrmlScene.Clear(0)
_wanted = slicer.mrmlScene.AddNewNodeByClass("vtkMRMLTableNode", "wanted")
_wanted.SetAttribute("Kind", "flow")
slicer.mrmlScene.AddNewNodeByClass("vtkMRMLTableNode", "other")
_selector = slicer.qMRMLNodeComboBox()
_selector.nodeTypes = ["vtkMRMLTableNode"]
_selector.addAttribute("vtkMRMLTableNode", "Kind")
_selector.noneEnabled = True
_selector.setMRMLScene(slicer.mrmlScene)
_check("a selector counts what it lists", _selector.nodeCount() == 1 and _selector.nodeFromIndex(0) is _wanted, _selector.nodeCount())
_activated = []
_selector.connect("nodeActivated(vtkMRMLNode*)", lambda node: _activated.append(node))
_selector.setCurrentNode(_wanted)
_selector.setCurrentNode(None)
_check("moving to a node activates it, moving to none does not", _activated == [_wanted], len(_activated))

# a signal wired to a slot that takes no arguments
_timer = qt.QTimer(); _timer.setInterval(100000); _timer.setSingleShot(True)
_selector.connect("currentNodeChanged(vtkMRMLNode*)", _timer, "start()")
_selector.setCurrentNode(_wanted)
_check("'start()' of a timer gets no arguments", _timer.isActive() and _timer.interval == 100000 or _timer.interval() == 100000)
_timer.stop()

# urllib
_info = urllib.request.urlopen(str(__import__("js").document.baseURI).split("?")[0] + "wheels/build-info.json", timeout=60)
_check("urlopen reads a file of a site", "slicerweb" in json.loads(_info.read()) and _info.status == 200)
try:
    urllib.request.urlopen("https://localhost:9/none")
    _check("urlopen says when it cannot", False)
except OSError as _error:
    _check("urlopen says when it cannot", True, type(_error).__name__)

# the Colors module's widget
_model = slicer.modules.models.logic().AddModel(vtk.vtkPolyData())
_model.SetName("legend model")
_colors = slicer.modules.colors.widgetRepresentation()
_colors.onDisplayableNodeChanged(_model)
_colors.createColorLegend()
_legend = slicer.util.findChildren(_colors, name="ColorLegendDisplayNodeWidget")[0].mrmlColorLegendDisplayNode()
_check("a color legend is made", _legend is not None)
slicer.util.findChildren(_colors, name="LabelTextPropertyWidget")[0].text = "%.3f"
_check("with its label format", _legend.GetLabelFormat() == "%.3f", _legend.GetLabelFormat())
_colors.deleteColorLegend()
_check("and deleted", slicer.vtkSlicerColorLogic.GetColorLegendDisplayNode(_model) is None)

# Probe Volume With Model: a volume whose voxels are their own k index, spacing 2 mm
_volume = slicer.mrmlScene.AddNewNodeByClass("vtkMRMLScalarVolumeNode", "ramp")
_values = np.zeros((10, 10, 10), dtype=np.float32)
for _k in range(10):
    _values[_k, :, :] = _k
slicer.util.updateVolumeFromArray(_volume, _values)
_volume.SetSpacing(2.0, 2.0, 2.0)
_volume.SetOrigin(0.0, 0.0, 0.0)
_points = vtk.vtkPoints()
_points.InsertNextPoint(4.0, 4.0, 6.0)    # k = z / 2 = 3
_points.InsertNextPoint(4.0, 4.0, 10.0)   # k = 5
_mesh = vtk.vtkPolyData(); _mesh.SetPoints(_points)
_probed = slicer.modules.models.logic().AddModel(_mesh)
slicer.cli.runSync(slicer.modules.probevolumewithmodel, None,
    {"InputVolume": _volume, "InputModel": _probed, "OutputModel": _probed, "OutputArrayName": "Sampled"})
_array = _probed.GetMesh().GetPointData().GetArray("Sampled")
_check("Probe Volume With Model samples the volume", _array is not None and [round(_array.GetValue(i), 3) for i in range(2)] == [3.0, 5.0],
       [_array.GetValue(i) for i in range(2)] if _array is not None else "no array")
_check("and keeps the points where they were", _probed.GetMesh().GetPoint(1) == (4.0, 4.0, 10.0), _probed.GetMesh().GetPoint(1))
json.dumps(_checks)
`, "exec").then(() => window.slicerWeb.bridge.evalPython("json.dumps(_checks)", "eval")))).replace(/^'|'$/g, "").replace(/\\'/g, "'").replace(/\\\\/g, "\\"));

let failures = 0;
for (const [name, ok, detail] of results) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
}
if (errors.length) { console.log(`FAIL errors on the page: ${errors.join(" | ")}`); failures++; }
await browser.close();
process.exit(failures ? 1 : 0);
