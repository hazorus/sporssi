// Vain tarvittavat ECharts-osat -> pienempi paketti.
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import {
  GridComponent, TooltipComponent, MarkAreaComponent, MarkLineComponent, LegendComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, MarkAreaComponent,
  MarkLineComponent, LegendComponent, CanvasRenderer]);

export default echarts;
