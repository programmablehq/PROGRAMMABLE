export const runtime="nodejs";
export async function GET(request:Request){
  const url=new URL(request.url),state=url.searchParams.get("state"),code=url.searchParams.get("code");
  const target=new URL("/launch/custom-ai",url.origin);
  if(state&&/^[A-Za-z0-9_-]{43}$/.test(state)&&code&&code.length<=4096){target.searchParams.set("oauth_state",state);target.searchParams.set("oauth_code",code);}
  else target.searchParams.set("oauth_error","authorization-failed");
  return new Response(null,{status:303,headers:{Location:target.href,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
}
