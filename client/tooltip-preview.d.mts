import type {NativeTooltipRenderer,TooltipBasic,TooltipItem} from './tooltip.mjs';
export function tooltipPreview(options:{renderer:NativeTooltipRenderer;point:(event:any)=>{x:number;y:number};
  getBasic:()=>TooltipBasic|undefined;getInstance:()=>TooltipItem|undefined;onOpen:()=>void;onClose:()=>void}):{
    readonly open:boolean;show(mode?:string):boolean;close(restore?:boolean):void;draw():void;
  };
