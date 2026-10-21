import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({scan:vi.fn()}));
vi.mock('./scanner.mjs',()=>({scanEcosystem:mocks.scan,cleanError:e=>e.message}));
const response=()=>({values:[],setHeader(){},write(line){this.values.push(JSON.parse(line));},end(){},status(){return this},json(){}});
beforeEach(()=>{vi.resetModules();mocks.scan.mockReset();});
it('waits for an older scan, then refreshes past a confirmed claim without running two jobs',async()=>{
 let finishOld,finishNew;
 mocks.scan.mockImplementationOnce(()=>new Promise(r=>{finishOld=r})).mockImplementationOnce(()=>new Promise(r=>{finishNew=r}));
 const {default:handler}=await import('../api/scan.mjs');
 const first=response(),second=response();
 const a=handler({method:'GET',url:'/api/scan?chainId=1'},first);
 const b=handler({method:'GET',url:'/api/scan?chainId=1&minimumBlock=200'},second);
 expect(mocks.scan).toHaveBeenCalledTimes(1);
 finishOld({blockNumber:'100',issues:[]});
 await vi.waitFor(()=>expect(mocks.scan).toHaveBeenCalledTimes(2));
 expect(mocks.scan.mock.calls[1][2]).toBe(200n);
 finishNew({blockNumber:'200',issues:[]});await Promise.all([a,b]);
 expect(first.values.find(x=>x.type==='result').result.blockNumber).toBe('100');
 expect(second.values.find(x=>x.type==='result').result.blockNumber).toBe('200');
});
it('does not keep a rejected in-flight job as a permanent loading state',async()=>{
 mocks.scan.mockRejectedValueOnce(new Error('Read interrupted')).mockResolvedValueOnce({blockNumber:'100',issues:[]});
 const {default:handler}=await import('../api/scan.mjs');
 const first=response(),second=response();
 await handler({method:'GET',url:'/api/scan?chainId=4663'},first);
 await handler({method:'GET',url:'/api/scan?chainId=4663'},second);
 expect(first.values.at(-1)).toEqual({type:'error',message:'Read interrupted'});
 expect(second.values.at(-1).type).toBe('result');
});
