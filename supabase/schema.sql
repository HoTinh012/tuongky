-- Tượng Kỳ — bảng dữ liệu trên Supabase.
-- Chạy MỘT LẦN trong Supabase Dashboard → SQL Editor → New query → dán toàn bộ file này → Run.
-- Chạy lại cũng không sao (chỉ tạo / thêm những gì chưa có, không xoá dữ liệu).
--
-- Server truy cập bằng khoá service_role (bỏ qua RLS). RLS được bật và KHÔNG có policy nào,
-- nên khoá anon/public không đọc được dữ liệu (mật khẩu đã băm, phiên đăng nhập...).
-- Thời gian lưu dạng số mili-giây (bigint) giống dữ liệu cũ trong data/db.json.

-- Tài khoản kỳ thủ
create table if not exists public.tk_accounts (
  id              text primary key,
  username        text not null unique,
  username_lower  text not null unique,
  display_name    text not null,
  salt            text not null,
  pass_hash       text not null,
  created_at      bigint not null,
  last_seen       bigint,
  banned          boolean not null default false,
  rating          integer not null default 1200,
  credit          integer not null default 1000,
  coins           integer not null default 0,
  streak          integer not null default 0,
  best_streak     integer not null default 0,
  region          text not null default '',
  last_bonus_day  text,
  avatar          text,
  player_no       text,
  stats           jsonb not null default '{}'::jsonb,   -- { online: {games,wins,losses,draws}, ai: {...} }
  solved_puzzles  jsonb not null default '[]'::jsonb,   -- mã các thế cờ đã giải
  games           jsonb not null default '[]'::jsonb    -- mã các ván đã chơi (cũ → mới)
);

-- Phiên đăng nhập (lưu sha256 của token, không lưu token gốc)
create table if not exists public.tk_sessions (
  token_hash  text primary key,
  account_id  text not null,
  expires     bigint not null
);
create index if not exists tk_sessions_account_idx on public.tk_sessions (account_id);

-- Lịch sử ván (online & đấu máy)
create table if not exists public.tk_games (
  id             text primary key,
  mode           text not null,              -- 'online' | 'ai'
  level          text,                       -- cấp máy (l1..l8) khi đấu máy
  started_at     bigint,
  ended_at       bigint not null,
  players        jsonb not null,             -- { r: {name, accountId}, b: {...} }
  result         jsonb not null,             -- { winner, reason }
  moves          jsonb not null,             -- [[fr, fc, tr, tc], ...]
  rating_change  jsonb,                      -- { r, b } khi ván tính Elo
  coin_change    jsonb                       -- { r, b } xu nhận được
);
create index if not exists tk_games_ended_idx on public.tk_games (ended_at desc);

-- Góp ý của người chơi
create table if not exists public.tk_feedback (
  id          text primary key,
  at          bigint not null,
  account_id  text,
  name        text not null default '',
  message     text not null,
  contact     text not null default ''
);

-- Thống kê chung (vd tổng số ván đã chơi)
create table if not exists public.tk_meta (
  key    text primary key,
  value  jsonb not null
);

-- Cờ thế
create table if not exists public.tk_puzzles (
  id           text primary key,
  title        text not null,
  description  text not null default '',
  difficulty   text not null,                -- 'easy' | 'medium' | 'hard'
  side         text not null,                -- bên đi trước 'r' | 'b'
  board        jsonb not null,
  solution     jsonb not null,
  published    boolean not null default true,
  created_at   bigint not null,
  updated_at   bigint not null,
  solved_by    integer not null default 0
);

-- Cài đặt (giao diện bàn cờ & quân cờ mặc định)
create table if not exists public.tk_settings (
  key    text primary key,
  value  jsonb not null
);

-- Giải đấu (toàn bộ thông tin giải: người chơi, các vòng, cặp đấu, kết quả)
create table if not exists public.tk_tournaments (
  id          text primary key,
  data        jsonb not null,
  updated_at  bigint not null default 0
);

-- Cột bổ sung (bản cập nhật tính năng: bạn bè, túi đồ, nhiệm vụ, Tranh xu, giải đấu, báo cáo)
alter table public.tk_accounts add column if not exists profile jsonb not null default '{}'::jsonb;  -- bạn bè, túi đồ, thông báo, nhiệm vụ...
alter table public.tk_games    add column if not exists extra   jsonb not null default '{}'::jsonb;  -- loại ván, mức đặt, nhịp, giải đấu
alter table public.tk_feedback add column if not exists type    text  not null default 'feedback';   -- 'feedback' | 'report'
alter table public.tk_feedback add column if not exists target  jsonb;                               -- kỳ thủ bị báo cáo
alter table public.tk_puzzles  add column if not exists topic   text  not null default 'mate';       -- chủ đề cờ thế

alter table public.tk_accounts enable row level security;
alter table public.tk_sessions enable row level security;
alter table public.tk_games    enable row level security;
alter table public.tk_feedback enable row level security;
alter table public.tk_meta     enable row level security;
alter table public.tk_puzzles  enable row level security;
alter table public.tk_settings enable row level security;
alter table public.tk_tournaments enable row level security;

-- Bucket công khai cho ảnh đại diện (avatars/) và ảnh bàn cờ (uploads/).
-- Đổi tên ở đây thì đặt SUPABASE_BUCKET trong .env cho khớp.
insert into storage.buckets (id, name, public)
values ('tuongky', 'tuongky', true)
on conflict (id) do update set public = true;
