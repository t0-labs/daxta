declare module 'class-transformer/cjs/storage' {
  export const defaultMetadataStorage: {
    findTypeMetadata(target: Function, propertyName: string): { typeFunction?: () => unknown } | undefined;
  };
}
