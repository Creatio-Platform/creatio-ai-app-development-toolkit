# Widgets, metrics and charts

Use this reference for indicators, gauges and charts on a page. Whether a field needs analytics at all: *Field-driven companions* in `page-record.md`. Where a rule's strength is not obvious, its lead sentence names it: **pass/fail**, **default** or **heuristic** (`SKILL.md`, *When rules collide*).

## Analytics and metric widgets

- Widgets: a single metric or count (`crt.IndicatorWidget`), a value on a scale (`crt.GaugeWidget`), charts (`crt.ChartWidget`), an embedded list (`crt.ListWidget`); confirm each with `get-component-info`.
- **Place widgets where they are seen first:** at the top of the `SideAreaProfileContainer` (or its template analog), or first in the tab that holds their data.
- **A widget gets its own island (default).** A gauge or a block of tiles does not share an island with input fields; a field joins it only when it explains that metric and the plan says so.
- **Metric color follows meaning.** A metric that signals a problem (overdue, failed, over the limit) takes the negative or attention color when its value needs action; neutral counts stay neutral. Colors, banned low-contrast colors and icons come from clio's `widget-color-and-icon` guide (`get-guidance`); the title carries the meaning too.
- **A small summary widget may be the first cell of the content field grid**: `column: 1` of the first field band, size XS or S, with the fields in the remaining columns and their `colSpan` math kept correct.

### Charts and metric tiles

- **Every chart answers a question named in the plan and shows all the data it compares (pass/fail on the rendered page).** A comparison chart (budget against actual) carries every series it names, each with data. A chart that answers no question is removed. Chart type: `design-judgement.md`, *Which chart*.
- **A chart goes beside the data it sums up (default):** at the top of the tab that holds its records, not on a separate tab. A dedicated Analytics tab is only for analytics spanning several areas of the record, and holds enough charts to fill a screen; with fewer than three such charts, place them on their data tabs.
- **Sizes and arrangement come from clio:** `get-guidance name=dashboard-and-home-page-layout` owns the chart and tile sizes, how many per row and the order of metrics and charts, and applies to a record page's chart area too. Check the rendered tab: the charts read as compact cards, several visible without scrolling.
- **The side profile column holds only small metrics**: XS or S tiles with an icon, or one tile across the island for a long value. Large charts go in the content area.
