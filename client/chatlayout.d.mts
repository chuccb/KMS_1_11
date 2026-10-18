export function wrapChatText(value:unknown,measure:(text:string)=>number,width?:number,continuation?:string):string[];
export function balloonLayout(text:string,measure:(text:string)=>number,dead?:boolean):{
  lines:string[];columns:number;width:number;height:number;x:number;y:number;arrowY:number;
};
export function followChat(sticky:boolean,lastScroll:number,now:number):boolean;
