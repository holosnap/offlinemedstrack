// Run tests in a non-UTC zone so UTC <-> local conversion bugs surface.
module.exports = async () => {
  process.env.TZ = 'America/New_York';
};
