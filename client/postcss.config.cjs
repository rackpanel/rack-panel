module.exports = {
  plugins: [
    require('tailwindcss'),
    require('postcss-preset-env')({
      stage: 2,
      browsers: ['android >= 4.4', 'chrome >= 30', 'last 2 versions'],
      autoprefixer: {
        flexbox: 'no-2009',
      },
      features: {
        'color-functional-notation': true,
        'hexadecimal-alpha-notation': true,
        'custom-properties': false,
      },
    }),
  ],
};
