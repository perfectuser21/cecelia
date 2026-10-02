import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,describe,it,expect} from 'vitest';
import GpuStatus from './GpuStatus';
afterEach(cleanup);
describe('GPU 观测状态',()=>{
 it('无数据明确未知，不画零利用率',()=>{render(<GpuStatus />);expect(screen.getByText('GPU：未知')).toBeInTheDocument();expect(screen.queryByText('0%')).toBeNull();});
 it('保留真实零，标记统一内存与采样来源',()=>{render(<GpuStatus gpu={{status:'present',source:'macos-ioreg',observed_at:'2026-10-02T00:00:00Z',devices:[{name:'Apple M4',utilization_percent:0,memory_kind:'unified',memory_used_bytes:268435456}]}}/>);expect(screen.getByText('0%')).toBeInTheDocument();expect(screen.getByText(/统一内存已用 256 MiB/)).toBeInTheDocument();expect(screen.getByText(/macOS IORegistry/)).toBeInTheDocument();});
 it('有设备缺统计，利用率仍显示未知',()=>{render(<GpuStatus gpu={{status:'present',source:'macos-ioreg',observed_at:null,devices:[{name:'Apple M1',utilization_percent:null,memory_kind:'unified',memory_used_bytes:null}]}}/>);expect(screen.getByText('利用率未知')).toBeInTheDocument();expect(screen.queryByText('0%')).toBeNull();});
});
