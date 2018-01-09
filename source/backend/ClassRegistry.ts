/*---------------------------------------------------------------------------------------------
|  $Copyright: (c) 2017 Bentley Systems, Incorporated. All rights reserved. $
 *--------------------------------------------------------------------------------------------*/
import { assert } from "@bentley/bentleyjs-core/lib/Assert";
import { EntityProps } from "../common/EntityProps";
import { IModelError, IModelStatus } from "../common/IModelError";
import { EntityCtor, Entity, EntityMetaData } from "./Entity";
import { IModelDb } from "./IModelDb";
import { Schema, Schemas } from "./Schema";

/** The mapping between a class name (schema.class) and its constructor function  */
export class ClassRegistry {
  private static classMap: Map<string, EntityCtor> = new Map<string, EntityCtor>();

  private static getKey(schemaName: string, className: string) {
    return (schemaName + ":" + className).toLowerCase();
  }
  public static lookupClass(name: string) { return this.classMap.get(name.toLowerCase()); }

  /** Check if the specified Error is a class-not-found error */
  public static isClassNotFoundError(err: any) {
    return (err instanceof IModelError) && ((err as IModelError).errorNumber === IModelStatus.NotFound);
  }

  /** Check if the specified Error is a metadata-not-found error */
  public static isMetaDataNotFoundError(err: any) {
    return (err instanceof IModelError) && ((err as IModelError).errorNumber === IModelStatus.NotFound);
  }

  /** Construct a class-not-found exception */
  public static makeClassNotFoundError(): IModelError { return new IModelError(IModelStatus.NotFound); }

  /** Construct a metadata-not-found exception */
  public static makeMetaDataNotFoundError(): IModelError {
    return new IModelError(IModelStatus.NotFound);
  }

  /** Called by IModelDb and others as part of constructing entities.
   * @throws IModelError if the required constructor or class metadata is not in the cache.
   * @hidden
   */
  public static createInstance(props: EntityProps, iModel: IModelDb): Entity {
    if (!props.classFullName)
      throw new IModelError(IModelStatus.BadArg);

    let ctor = ClassRegistry.classMap.get(props.classFullName.toLowerCase());
    if (!ctor) {
      ctor = ClassRegistry.generateClass(props.classFullName, iModel);
      if (!ctor)
        throw ClassRegistry.makeClassNotFoundError();
    }

    return new ctor(props, iModel);
  }

  public static registerSchema(schema: Schema) { Schemas.registerSchema(schema); }
  public static getRegisteredSchema(domainName: string) { return Schemas.getRegisteredSchema(domainName); }
  public static getSchemaBaseClass() { return Schema; }

  private static generateProxySchema(schemaName: string): string {
    return "class " + schemaName + " extends ClassRegistry.getSchemaBaseClass(){} ClassRegistry.registerSchema(" + schemaName + ");";
  }

  /** Generate a JS class from an Entity metadata
   * @param entityMetaData The Entity metadata
   */
  private static generateClassFromMetaData(entityMetaData: EntityMetaData): string {
    const name = entityMetaData.ecclass.split(":");
    const schema = name[0];
    const className = name[1];
    // static properties
    const classStaticProps = className + ".schema = ClassRegistry.getRegisteredSchema('" + schema + "');";

    // extends
    let classExtends = "";
    if (entityMetaData.baseClasses.length !== 0) {
      classExtends = "extends ClassRegistry.lookupClass(entityMetaData.baseClasses[0])";
    }

    // constructor -- all classes derived from Entity (Element) just defer to super. They don't set any of their own
    // properties. That is because the base class uses the class metadata to detect and set all auto-handled properties.
    // Therefore, none of these derived classes need constructors. The one generated by JS is sufficient.

    // make sure schema exists
    const domainDef = Schemas.getRegisteredSchema(schema) ? "" : ClassRegistry.generateProxySchema(schema);

    // The class as a whole
    return domainDef + "class " + className + " " + classExtends + " { } " + classStaticProps;
  }

  public static registerEcClass(ctor: EntityCtor) {
    const key = ClassRegistry.getKey(ctor.schema.name, ctor.name);
    ClassRegistry.classMap.set(key, ctor);
  }

  /** Register all of the classes that derive from Entity, that are found in a given module
   * @param moduleObj The module to search for subclasses of Entity
   * @param schema The schema for all found classes
   */
  public static registerModuleClasses(moduleObj: any, schema: Schema) {
    for (const thisMember in moduleObj) {
      if (!thisMember)
        continue;

      const thisClass = moduleObj[thisMember];
      if (thisClass instanceof Entity.constructor) {
        thisClass.schema = schema;
        ClassRegistry.registerEcClass(thisClass);
      }
    }
  }

  /** This function fetches the specified Entity from the imodel, generates a JS class for it, and registers the generated
   * class. This function also ensures that all of the base classes of the Entity exist and are registered.
   */
  private static generateClass(classFullName: string, iModel: IModelDb): EntityCtor {

    const metadata: EntityMetaData | undefined = iModel.classMetaDataRegistry.find(classFullName);
    if (metadata === undefined || metadata.ecclass === undefined)
      throw ClassRegistry.makeMetaDataNotFoundError();

    // Make sure that we have all base classes registered.
    // This recurses. I have to know that the super class is defined and registered before defining a derived class.
    if (metadata!.baseClasses && metadata.baseClasses.length !== 0) {
      ClassRegistry.getClass(metadata.baseClasses[0], iModel);
    }

    // Now we can generate the class from the classDef.
    return ClassRegistry.generateClassForEntity(metadata);
  }

  /** This function generates a JS class for the specified Entity and registers it. It is up to the caller
   * to make sure that all superclasses are already registered.
   */
  public static generateClassForEntity(entityMetaData: EntityMetaData): EntityCtor {
    const name = entityMetaData.ecclass.split(":");
    // Generate and register this class
    const jsDef = ClassRegistry.generateClassFromMetaData(entityMetaData) + " ClassRegistry.registerEcClass(" + name[1] + "); ";

    // tslint:disable-next-line:no-eval NOTE: eval is OK here, because we just generated the expression
    eval(jsDef);

    const ctor = ClassRegistry.lookupClass(entityMetaData.ecclass)!;
    assert(!!ctor);
    return ctor;
  }

  /** Get the class for the specified Entity.
   * @param fullName The name of the Entity
   * @param iModel The IModel that contains the class definitions
   * @returns A promise that resolves to an object containing a result property set to the Entity.
   * @throws [[IModelError]] if the class is not found.
   */
  public static getClass(fullName: string, iModel: IModelDb): EntityCtor {
    const key = fullName.toLowerCase();
    if (!ClassRegistry.classMap.has(key)) {
      return ClassRegistry.generateClass(fullName, iModel);
    }
    const ctor = ClassRegistry.classMap.get(key);
    assert(!!ctor);

    if (!ctor)
      throw ClassRegistry.makeClassNotFoundError();

    return ctor!;
  }

  /** Check if the class for the specified Entity is in the registry.
   * @param schemaName The name of the schema
   * @param className The name of the class
   */
  public static isClassRegistered(schemaName: string, className: string): boolean {
    return ClassRegistry.classMap.has(ClassRegistry.getKey(schemaName, className));
  }
}

/** A cache that records mappings between class names and class metadata */
export class MetaDataRegistry {
  private _registry: Map<string, EntityMetaData> = new Map<string, EntityMetaData>();

  /** Get the specified Entity metadata */
  public find(classFullName: string): EntityMetaData | undefined {
    const key = classFullName.toLowerCase();
    return this._registry.get(key);
  }

  /** Add metadata to the cache */
  public add(classFullName: string, metaData: EntityMetaData): void {
    const key = classFullName.toLowerCase();
    this._registry.set(key, metaData);
  }
}
