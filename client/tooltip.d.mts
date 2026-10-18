export interface TooltipIcon {path:string;width:number;height:number;ox:number;oy:number;}
export interface TooltipItem {itemId:number;stats?:Record<string,number>;ruc?:number;cuc?:number;}
export interface TooltipFacts {
  name?:string;desc?:string;icon?:TooltipIcon;
  requirements?:{level:number;str:number;dex:number;int:number;luk:number;job:number};
  equipment?:{stats:Record<string,number>;ruc:number;cuc?:number};
}
export interface TooltipSkill {
  name:string;desc?:string;icon?:TooltipIcon;maxLevel:number;
  levels:{level:number;hs:string}[];
}
export interface TooltipMetrics {width(text:string,font:number):number;height(font:number):number;}
export interface TooltipBasic {level:number;str:number;dex:number;int:number;luk:number;}
export interface TooltipText {kind:'text';text:string;x:number;y:number;font:number;center:boolean;}
export interface TooltipImage {kind:'image';path:string;x:number;y:number;width:number;height:number;ox?:number;oy?:number;}
export interface TooltipRect {kind:'rect';x:number;y:number;width:number;height:number;color:string;}
export interface TooltipPlan {type:number;width:number;height:number;separator:number;commands:(TooltipText|TooltipImage|TooltipRect)[];}
export const TOOLTIP_FONTS: Readonly<Record<number,{font:string;color:string;height:number}>>;
export function tooltipAnchor(source:string,x:number,y:number):{x:number;y:number};
export function tooltipPosition(x:number,y:number,width:number,height:number):{x:number;y:number};
export function tooltipRows(lines:string[],measure:(text:string)=>number,maxWidth:number):string[];
export function nativeTooltipRows(text:string,measure:(text:string)=>number,width:number):string[];
export function drawTooltipFrame(ctx:any,x:number,y:number,width:number,height:number,keyline?:boolean):void;
export function drawTextTooltip(ctx:any,x:number,y:number,lines:string[],options?:{maxWidth?:number;keyline?:boolean}):void;
export function drawSimpleTooltip(ctx:any,x:number,y:number,text:string,options?:{font?:string;fontHeight?:number}):void;
export function nativeItemTooltip(facts:TooltipFacts|undefined,metrics:TooltipMetrics):TooltipPlan|undefined;
export function nativeSkillTooltip(skill:TooltipSkill|undefined,level:number,metrics:TooltipMetrics):TooltipPlan|undefined;
export function nativeEquipmentTooltip(facts:TooltipFacts|undefined,item:TooltipItem,basic:TooltipBasic|undefined,
  metrics:TooltipMetrics,options?:{template?:boolean}):TooltipPlan|undefined;
export interface NativeTooltipRenderer {
  item(x:number,y:number,facts:TooltipFacts|undefined,item:TooltipItem,basic:TooltipBasic|undefined,options?:{template?:boolean}):void;
  skill(x:number,y:number,facts:TooltipSkill|undefined,level:number):void;
  clear():void;
}
export function nativeTooltipRenderer(options:{ctx:any;image:(path:string)=>{ready:boolean;img:any}}):NativeTooltipRenderer;
