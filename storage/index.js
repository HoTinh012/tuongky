// Chọn nơi lưu dữ liệu: Supabase nếu đã đặt SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, ngược lại file JSON trong data/.
const useSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
module.exports = useSupabase ? require('./supabase') : require('./file');
