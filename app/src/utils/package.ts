import pkg from '../../package.json';

pkg.desktopName = pkg.desktopName || (pkg.name ? `${pkg.name}.desktop` : 'SummerMail.desktop');

export default pkg;
