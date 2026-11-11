// Vain tarvittavat ECharts-osat -> pienempi paketti.
import * as echarts from 'echarts/core';
import { BarChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  GridComponent, TooltipComponent, MarkAreaComponent, MarkLineComponent, LegendComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, LineChart, ScatterChart, GridComponent, TooltipComponent, MarkAreaComponent,
  MarkLineComponent, LegendComponent, CanvasRenderer]);

export default echarts;
